import React, { useState, useEffect, useRef } from 'react';
import { Plus, Search, Settings, ChevronLeft, Trash2, Share, X, Mic, Image as ImageIcon, Type as TypeIcon, Loader2, Clock, Calendar, ChevronRight, Check, Sparkles, Quote, Edit2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { GoogleGenAI, Type } from "@google/genai";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- IndexedDB Wrapper ---
const DB_NAME = 'SmartMemosDB';
const STORE_NAME = 'memos';

async function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllMemos(): Promise<Memo[]> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveMemoToDB(memo: Memo) {
  const db = await initDB();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).put(memo);
}

async function deleteMemoFromDB(id: string) {
  const db = await initDB();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).delete(id);
}

async function clearAllMemos() {
  const db = await initDB();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).clear();
}

// --- Utilities ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

async function compressImage(base64Str: string, maxWidth = 800, quality = 0.7): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = (maxWidth / width) * height;
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
  });
}

// --- Types ---
type MemoType = '灵感记录' | '会议纪要' | '日常随笔' | '任务清单' | '英语拾贝' | '好文收藏';
const MEMO_TYPES: MemoType[] = ['灵感记录', '会议纪要', '日常随笔', '任务清单', '英语拾贝', '好文收藏'];

type BlockType = 'text' | 'list' | 'highlight' | 'step' | 'bento' | 'todo' | 'quote';

interface TodoItem {
  task: string;
  time?: string;
  notes?: string;
  completed: boolean;
}

interface ContentBlock {
  type: BlockType;
  title?: string;
  content: string | string[];
  todoItems?: TodoItem[];
  color?: 'blue' | 'emerald' | 'amber' | 'violet' | 'rose' | 'slate';
}

interface Memo {
  id: string;
  type: MemoType;
  title: string;
  content: string; // Keep for backward compatibility/fallback
  blocks?: ContentBlock[]; // New structured content
  rawText?: string;
  imageUrl?: string;
  audioUrl?: string;
  timestamp: number;
}

// --- Audio Compression Utility ---
async function compressAudio(base64: string): Promise<string> {
  try {
    const response = await fetch(base64);
    const blob = await response.blob();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // Create an offline context to "render" the audio at a lower sample rate
    // We target 16kHz mono to significantly reduce size
    const offlineContext = new OfflineAudioContext(
      1, 
      audioBuffer.length, 
      16000
    );
    
    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start();
    
    const renderedBuffer = await offlineContext.startRendering();
    
    // Convert AudioBuffer to WAV (simplest browser-native format we can encode manually)
    const wavBlob = audioBufferToWav(renderedBuffer);
    
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(wavBlob);
    });
  } catch (e) {
    console.error("Audio compression failed, using original:", e);
    return base64;
  }
}

// Helper to encode AudioBuffer to WAV
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  // write WAVE header
  setUint32(0x46464952);                         // "RIFF"
  setUint32(length - 8);                         // file length - 8
  setUint32(0x45564157);                         // "WAVE"

  setUint32(0x20746d66);                         // "fmt " chunk
  setUint32(16);                                 // length = 16
  setUint16(1);                                  // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan);  // avg. bytes/sec
  setUint16(numOfChan * 2);                      // block-align
  setUint16(16);                                 // 16-bit (hardcoded)

  setUint32(0x61746164);                         // "data" - chunk
  setUint32(length - pos - 4);                   // chunk length

  // write interleaved data
  for(i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while(pos < length) {
    for(i = 0; i < numOfChan; i++) {             // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
      sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF) | 0; // scale to 16-bit signed int
      view.setInt16(pos, sample, true);          // write 16-bit sample
      pos += 2;
    }
    offset++;                                     // next source sample
  }

  return new Blob([bufferArr], {type: "audio/wav"});

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
}

// --- AI Service ---
const getApiKey = () => {
  const savedKey = typeof window !== 'undefined' ? localStorage.getItem('gemini_api_key') : null;
  return savedKey || process.env.GEMINI_API_KEY || "";
};

async function analyzeMemo(
  type: MemoType,
  text?: string,
  imageB64?: string,
  audioB64?: string,
  retryCount = 0
) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("API_KEY_MISSING");
  }
  
  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-3-flash-preview";
  
  const now = new Date();
  const currentTimeContext = `当前时间是: ${now.toLocaleString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;

  let systemInstruction = `你是一位顶级的视觉化笔记与任务管理专家，擅长将杂乱的输入转化为极具设计感的结构化笔记。
  你的目标是：**全量信息迁移与视觉重构 (Full Content Migration & Visual Reconstruction)**。
  
  ${currentTimeContext}
  请利用上述当前时间背景，智能解析用户提到的相对时间。

  **核心原则：严禁虚构内容 (STRICT NO HALLUCINATION)**
  - 你只能基于用户提供的文字、图片或语音内容进行整理。
  - **严禁生成用户未提及的任务、计划或未来行动**。

  **视觉重构准则：**
  1. **禁止偷懒**：严禁仅提取几个关键词而忽略大部分原文信息。你必须将用户输入的 **100% 核心信息** 重新分配到各个“块(blocks)”中。
  2. **信息密度**：每个块的内容必须充实、有深度。严禁生成只有标题没有内容的空洞块。
  3. **视觉层次**：通过交替使用不同的块类型(type)和颜色(color)来创造“杂志排版”感。
  4. **标题索引**：每个块必须配上一个精准、有吸引力的“小标题(title)”。

  可用块类型：
  1. "highlight": 用于核心洞察、金句或最重要的结论。
  2. "quote": 用于摘录感性、优美或具有代表性的原文片段。
  3. "step": 用于逻辑推导、时间线或有先后顺序的思考。
  4. "bento": 用于并列的观察、分类说明或多维度细节，适合信息密集的网格展示。
  5. "list": 用于具体的清单、项次编号或要点罗列。
  6. "text": 用于经过你重新润色、分段、排版后的叙述性内容。
  7. "todo": 仅用于内容中明确提到的具体任务。

  颜色分配建议：
  - 蓝色(blue): 逻辑、技术、专业
  - 绿色(emerald): 成功、积极、自然
  - 黄色(amber): 灵感、温馨、提醒
  - 紫色(violet): 创意、深度、情感
  - 红色(rose): 紧急、生活、热烈
  - 灰色(slate): 平静、客观、背景
  
  请务必使用中文回复，并严格遵守 JSON 格式。`;

  // ... (rest of the system instruction logic remains similar but adapted for blocks)
  switch (type) {
    case '灵感记录':
      systemInstruction += `\n重点：使用 highlight 块展示核心灵感，使用 bento 块展示应用场景。`;
      break;
    case '会议纪要':
      systemInstruction += `\n**【会议纪要专项指令：深度捕获与全量还原】**
      1. **严禁过度浓缩**：会议纪要必须保持极高的信息密度。严禁跳过讨论细节、背景或多方观点。
      2. **全量信息分配**：你必须将会议的每一个议程、每一项决策、每一段关键讨论都分配到对应的块中。
      3. **深度结构化要求**：
         - 会议背景/议程 -> 使用 "text" 块。
         - 讨论流/逻辑演进 -> 使用 "step" 块（必须详尽，还原讨论过程）。
         - 核心结论/决策 -> 使用 "highlight" 块。
         - 多方观点/并列议题 -> 使用 "bento" 块（适合展示不同部门或人员的反馈）。
         - 任务/待办 -> 必须使用 "todo" 块，且每个任务必须包含时间、责任人和具体要求。
      4. **视觉厚度**：强制要求生成至少 8-12 个 blocks，以确保内容的完整性。
      5. **目标**：让未参会的人通过这份笔记也能完全还原会议的实况、逻辑和所有产出。`;
      break;
    case '任务清单':
      systemInstruction += `\n重点：将任务严格按类型归类，每类使用一个 todo 块。每个任务项必须包含时间、内容和要点。`;
      break;
    case '英语拾贝':
      systemInstruction += `\n重点：使用 highlight 块展示核心短语，使用 bento 块展示例句和语境。`;
      break;
    case '好文收藏':
      systemInstruction += `\n重点：
      - 如果是文字内容：使用 highlight 块提取金句，使用 quote 块摘录精彩片段。
      - 如果是图片内容（漫画、照片、插画）：分析其视觉隐喻、情感内核或艺术风格，使用 highlight 块总结其“一眼万年”的精髓。
      - 如果是专业图表（流程图、数据图表、论文插画）：解析其逻辑结构或核心趋势。使用 step 块还原流程逻辑，使用 bento 块列出关键数据点或发现。
      - 综合分析：使用 bento 块分析用户收藏此内容的深层意图（如：审美积累、逻辑参考、数据佐证等）。`;
      break;
    case '日常随笔':
      systemInstruction += `\n**【日常随笔专项指令：视觉笔记设计师模式】**
      1. **全量迁移**：禁止将原文堆砌在 summary。你必须将随笔的 **全部实质内容** 拆解并重构进至少 6-10 个 blocks 中。
      2. **排版即艺术**：
         - 感性/抒情部分 -> "quote" 块。
         - 核心感悟/金句 -> "highlight" 块。
         - 细节观察/并列事物 -> "bento" 块。
         - 思考逻辑/心路历程 -> "step" 块。
         - 叙述性描述 -> 重新润色并分段后放入 "text" 块。
      3. **视觉节奏**：严禁连续使用同一种块类型。请通过颜色和类型的交替，营造出“线条导引”和“缩进”的视觉美感。
      4. **目标**：让用户在不看原文的情况下，通过这些色块就能读懂整篇随笔的灵魂、细节和逻辑。`;
      break;
  }

  const parts: any[] = [{ text: systemInstruction }];
  if (text) parts.push({ text: `文字内容: ${text}` });
  if (imageB64) parts.push({ inlineData: { mimeType: "image/jpeg", data: imageB64.split(',')[1] || imageB64 } });
  if (audioB64) {
    const mimeMatch = audioB64.match(/^data:(audio\/[a-z0-9]+);base64,/);
    parts.push({ inlineData: { mimeType: mimeMatch ? mimeMatch[1] : "audio/wav", data: audioB64.split(',')[1] || audioB64 } });
  }

  let response;
  try {
    response = await ai.models.generateContent({
      model,
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            summary: { type: Type.STRING, description: "极简一句话引子，严禁超过30字" },
            blocks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, enum: ["highlight", "step", "bento", "text", "list", "todo", "quote"] },
                  title: { type: Type.STRING, description: "块的小标题，必须存在以建立视觉索引" },
                  content: { 
                    type: Type.ARRAY, 
                    items: { type: Type.STRING },
                    description: "内容数组，必须包含实质性、高密度的信息，严禁空洞"
                  },
                  todoItems: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        task: { type: Type.STRING },
                        time: { type: Type.STRING },
                        notes: { type: Type.STRING },
                        completed: { type: Type.BOOLEAN }
                      },
                      required: ["task", "completed"]
                    }
                  },
                  color: { type: Type.STRING, enum: ["blue", "emerald", "amber", "violet", "rose", "slate"] }
                },
                required: ["type", "title", "content"]
              }
            }
          },
          required: ["title", "summary", "blocks"]
        }
      }
    });
  } catch (error) {
    if (retryCount < 1) {
      console.warn(`AI Analysis failed, retrying... (Attempt ${retryCount + 1})`, error);
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 2000));
      return analyzeMemo(type, text, imageB64, audioB64, retryCount + 1);
    }
    throw error;
  }

  let rawText = response.text;
  // Strip markdown code blocks if present
  if (rawText.includes("```json")) {
    rawText = rawText.split("```json")[1].split("```")[0];
  } else if (rawText.includes("```")) {
    rawText = rawText.split("```")[1].split("```")[0];
  }
  
  return JSON.parse(rawText.trim());
}

// --- Components ---

function StructuredRenderer({ blocks, onToggleTodo }: { blocks: ContentBlock[]; onToggleTodo?: (blockIdx: number, itemIdx: number) => void }) {
  if (!blocks || !Array.isArray(blocks)) return null;

  const ensureArray = (content: any): string[] => {
    if (Array.isArray(content)) return content;
    if (typeof content === 'string') return [content];
    return [];
  };

  return (
    <div className="space-y-8">
      {blocks.map((block, idx) => {
        if (!block) return null;
        
        const colorClasses = {
          blue: "bg-[#F0F7FF] border-[#E0EFFF] text-[#0056B3]",
          emerald: "bg-[#F0FDF4] border-[#DCFCE7] text-[#166534]",
          amber: "bg-[#FFFBEB] border-[#FEF3C7] text-[#92400E]",
          violet: "bg-[#F5F3FF] border-[#EDE9FE] text-[#5B21B6]",
          rose: "bg-[#FFF1F2] border-[#FFE4E6] text-[#9F1239]",
          slate: "bg-[#F8FAFC] border-[#F1F5F9] text-[#334155]",
        }[block.color || 'slate'];

        const accentColor = {
          blue: "#007AFF",
          emerald: "#10B981",
          amber: "#F59E0B",
          violet: "#8B5CF6",
          rose: "#F43F5E",
          slate: "#64748B",
        }[block.color || 'slate'];

        const contentArray = ensureArray(block.content);

        switch (block.type) {
          case 'todo':
            return (
              <div key={idx} className="space-y-4">
                {block.title && (
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-[1px] flex-1 bg-black/5" />
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] whitespace-nowrap">
                      {block.title}
                    </h4>
                    <div className="h-[1px] flex-1 bg-black/5" />
                  </div>
                )}
                <div className="space-y-2 relative pl-4">
                  <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-black/5" />
                  {block.todoItems?.map((item, iIdx) => (
                    <div 
                      key={iIdx} 
                      onClick={() => onToggleTodo?.(idx, iIdx)}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer group",
                        item.completed ? "bg-transparent border-transparent opacity-40" : "bg-white border-black/5 shadow-sm hover:shadow-md active:scale-[0.99]"
                      )}
                    >
                      <div className={cn(
                        "w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-all",
                        item.completed ? "bg-[#1A1A1A] border-[#1A1A1A]" : "border-gray-200 group-hover:border-gray-400"
                      )}>
                        {item.completed && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-start gap-2">
                          <span className={cn("text-sm font-medium leading-snug", item.completed && "line-through text-gray-400")}>
                            {item.task}
                          </span>
                          {item.time && <span className="text-[9px] font-bold text-gray-400 border border-black/5 px-1.5 py-0.5 rounded uppercase tracking-wider">{item.time}</span>}
                        </div>
                        {item.notes && <p className="text-[11px] text-gray-500 mt-1 leading-relaxed italic">{item.notes}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          case 'highlight':
            return (
              <motion.div 
                key={idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("p-8 rounded-3xl border border-dashed relative overflow-hidden", colorClasses)}
              >
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <Sparkles className="w-12 h-12" />
                </div>
                {block.title && <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] mb-3 opacity-50">{block.title}</h4>}
                <p className="text-xl font-serif font-medium leading-relaxed italic">{contentArray[0]}</p>
              </motion.div>
            );
          case 'quote':
            return (
              <div key={idx} className="relative py-4 px-8 border-l-[1px] border-black/20">
                <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-black/5" />
                <Quote className="absolute -left-3 top-0 w-6 h-6 text-black/5" />
                <p className="text-lg font-serif italic text-gray-700 leading-relaxed">
                  {contentArray[0]}
                </p>
                {block.title && <p className="mt-3 text-xs font-bold text-gray-400 uppercase tracking-widest">— {block.title}</p>}
              </div>
            );
          case 'step':
            return (
              <div key={idx} className="space-y-6 relative pl-8 py-2">
                <div className="absolute left-[11px] top-4 bottom-4 w-[1px] bg-black/5" />
                {contentArray.map((step, sIdx) => (
                  <div key={sIdx} className="relative">
                    <div className="absolute -left-[25px] top-1.5 w-2 h-2 rounded-full bg-white border border-black/20 shadow-sm z-10" />
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Step {sIdx + 1}</span>
                      <p className="text-sm font-medium text-gray-800 leading-relaxed">{step}</p>
                    </div>
                  </div>
                ))}
              </div>
            );
          case 'bento':
            return (
              <div key={idx} className="grid grid-cols-2 gap-4">
                {contentArray.map((item, bIdx) => (
                  <div key={bIdx} className={cn("p-5 rounded-2xl border border-black/5 flex flex-col justify-center min-h-[100px] shadow-sm hover:shadow-md transition-shadow", colorClasses)}>
                    <p className="text-xs font-bold leading-relaxed tracking-tight">{item}</p>
                  </div>
                ))}
              </div>
            );
          case 'list':
            return (
              <div key={idx} className="space-y-4">
                {block.title && <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-2">{block.title}</h4>}
                <div className="space-y-3 relative pl-6">
                  <div className="absolute left-0 top-2 bottom-2 w-[1px] bg-black/5" />
                  {contentArray.map((item, lIdx) => (
                    <div key={lIdx} className="flex items-start gap-3 text-sm text-gray-700 group">
                      <div className="mt-2 w-1 h-1 rounded-full bg-black/20 group-hover:bg-black/40 transition-colors shrink-0" />
                      <span className="leading-relaxed">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          default:
            return (
              <div key={idx} className="space-y-3">
                {block.title && <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">{block.title}</h4>}
                <div className="relative pl-6">
                  <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-black/5" />
                  <div className="space-y-3">
                    {contentArray.map((p, pIdx) => (
                      <p key={pIdx} className="text-sm text-gray-600 leading-relaxed">{p}</p>
                    ))}
                  </div>
                </div>
              </div>
            );
        }
      })}
    </div>
  );
}

function MemoCard({ memo, onClick }: { memo: Memo; onClick: () => void }) {
  const date = new Date(memo.timestamp);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className="bg-white rounded-3xl p-5 mb-4 cursor-pointer active:scale-[0.98] transition-all border border-black/[0.03] shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)]"
    >
      <div className="flex justify-between items-center mb-3">
        <span className="px-2 py-0.5 bg-[#1A1A1A]/5 text-[#1A1A1A] text-[9px] font-bold rounded uppercase tracking-[0.15em]">
          {memo.type}
        </span>
        <div className="flex items-center gap-1 text-gray-400 text-[9px] font-medium uppercase tracking-wider">
          <Clock className="w-3 h-3" />
          {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
      <h3 className="text-xl font-serif font-bold text-[#1A1A1A] mb-2 line-clamp-1 leading-tight">{memo.title}</h3>
      <div className="text-sm text-gray-500 line-clamp-2 mb-4 leading-relaxed font-medium">
        {memo.blocks && Array.isArray(memo.blocks) ? (
          <p>
            {(() => {
              const firstTextBlock = memo.blocks.find(b => b.type === 'text' || b.type === 'highlight');
              if (firstTextBlock) {
                const content = firstTextBlock.content;
                if (Array.isArray(content)) return content[0];
                if (typeof content === 'string') return content;
              }
              return memo.content;
            })()}
          </p>
        ) : (
          <ReactMarkdown>{memo.content}</ReactMarkdown>
        )}
      </div>
      {memo.imageUrl && (
        <div className="mb-4 rounded-2xl overflow-hidden h-32 border border-black/5">
          <img src={memo.imageUrl} alt="Memo" className="w-full h-full object-cover grayscale-[0.2] hover:grayscale-0 transition-all" />
        </div>
      )}
      <div className="flex items-center justify-between pt-4 border-t border-black/[0.03]">
        <div className="flex items-center gap-1.5 text-gray-400 text-[9px] font-bold uppercase tracking-widest">
          <Calendar className="w-3 h-3" />
          {date.toLocaleDateString('zh-CN')}
        </div>
        <div className="w-6 h-6 rounded-full bg-black/[0.02] flex items-center justify-center">
          <ChevronRight className="w-3 h-3 text-gray-300" />
        </div>
      </div>
    </motion.div>
  );
}

function MemoCreator({ onClose, onSave }: { onClose: () => void; onSave: (memo: any) => void }) {
  const [type, setType] = useState<MemoType>('灵感记录');
  const [text, setText] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [audio, setAudio] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const compressed = await compressImage(reader.result as string);
        setImage(compressed);
      };
      reader.readAsDataURL(file);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 
                       MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 
                       'audio/ogg';
      
      // Use a lower bitrate (32kbps) to ensure long recordings (e.g. 20-30 mins) 
      // don't exceed API payload limits (approx 20MB).
      const mediaRecorder = new MediaRecorder(stream, { 
        mimeType,
        audioBitsPerSecond: 32000 
      });
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        
        // Check size: if > 15MB, warn the user
        if (audioBlob.size > 15 * 1024 * 1024) {
          alert("录音文件过大（超过15MB），AI 分析可能会失败。建议缩短录音时长。");
        }

        const reader = new FileReader();
        reader.onloadend = () => setAudio(reader.result as string);
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      alert("无法访问麦克风，请检查权限设置。");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleDirectSave = () => {
    if (!text && !image && !audio) return;
    
    // Extract title from first line of text or use a default
    const firstLine = text.split('\n')[0].trim();
    const title = firstLine.length > 0 ? (firstLine.length > 20 ? firstLine.substring(0, 20) + '...' : firstLine) : (image ? '图片备忘' : '语音备忘');
    
    onSave({
      id: Date.now().toString(),
      type,
      title,
      content: text || (image ? "图片备忘" : "语音备忘"),
      rawText: text,
      imageUrl: image,
      audioUrl: audio,
      timestamp: Date.now(),
    });
    onClose();
  };

  const handleAISave = async () => {
    if (!text && !image && !audio) return;
    setIsAnalyzing(true);
    setAnalysisProgress('准备分析数据...');
    
    try {
      let finalAudio = audio;
      
      // Smart Audio Handling
      if (audio) {
        const audioSize = (audio.length * 3) / 4; // Approx size in bytes from base64
        if (audioSize > 10 * 1024 * 1024) { // If > 10MB, try to compress
          setAnalysisProgress('音频较大，正在智能压缩...');
          try {
            finalAudio = await compressAudio(audio);
            const newSize = (finalAudio.length * 3) / 4;
            console.log(`Audio compressed: ${(audioSize/1024/1024).toFixed(2)}MB -> ${(newSize/1024/1024).toFixed(2)}MB`);
          } catch (err) {
            console.error("Compression error:", err);
          }
        }
      }

      setAnalysisProgress('正在请求 Gemini AI 分析...');
      const analysis = await analyzeMemo(type, text, image || undefined, finalAudio || undefined);
      
      setAnalysisProgress('正在处理分析结果...');
      onSave({
        id: Date.now().toString(),
        type,
        title: analysis.title,
        content: analysis.summary || "",
        blocks: analysis.blocks,
        rawText: text,
        imageUrl: image,
        audioUrl: finalAudio,
        timestamp: Date.now(),
      });
      setAnalysisProgress('完成！');
      onClose();
    } catch (error: any) {
      console.error("AI Analysis Error:", error);
      setAnalysisProgress('');
      if (error.message === 'API_KEY_MISSING') {
        alert('请先在设置中配置 Gemini API Key');
      } else if (error.message?.includes('413') || error.message?.includes('too large')) {
        alert('错误：内容过大（413 Payload Too Large）。请尝试缩短录音时长或减少图片数量。');
      } else if (error.message?.includes('quota') || error.message?.includes('429')) {
        alert('错误：AI 额度已耗尽或请求过于频繁，请稍后再试。');
      } else {
        alert(`分析失败：${error.message || '未知错误'}。可能是因为录音过长导致超时。请尝试再次点击“AI 整理”或缩短录音。`);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <motion.div
      initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed inset-0 z-50 flex flex-col bg-[#F2F2F7]"
    >
      <div className="ios-blur sticky top-0 px-4 py-3 flex items-center justify-between">
        <button onClick={onClose} className="text-[#007AFF] text-lg font-medium ios-button">取消</button>
        <h2 className="text-lg font-semibold">新建备忘录</h2>
        <div className="flex gap-3">
          <button
            onClick={handleDirectSave}
            disabled={(!text && !image && !audio) || isAnalyzing}
            className="text-gray-500 text-sm font-medium ios-button disabled:opacity-30"
          >
            直接保存
          </button>
          <button
            onClick={handleAISave}
            disabled={(!text && !image && !audio) || isAnalyzing}
            className={cn("text-[#007AFF] text-sm font-bold ios-button disabled:opacity-30", isAnalyzing && "flex items-center gap-1")}
          >
            {isAnalyzing ? (
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-[10px] font-medium animate-pulse">{analysisProgress}</span>
              </div>
            ) : "AI 整理"}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <section>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider ml-1 mb-2 block">备忘录类型</label>
          <div className="flex flex-wrap gap-2">
            {MEMO_TYPES.map((t) => (
              <button
                key={t} onClick={() => setType(t)}
                className={cn("px-4 py-2 rounded-full text-sm font-medium transition-all ios-button", type === t ? "bg-[#007AFF] text-white shadow-md" : "bg-white text-gray-600 border border-black/5")}
              >
                {t}
              </button>
            ))}
          </div>
        </section>
        <section className="ios-card p-4 space-y-4">
          <textarea
            value={text} onChange={(e) => setText(e.target.value)}
            placeholder="在想什么？"
            className="w-full min-h-[100px] bg-transparent resize-none focus:outline-none text-lg"
          />
          {audio && (
            <div className="flex items-center gap-3 p-3 bg-[#007AFF]/5 rounded-xl border border-[#007AFF]/10">
              <div className="w-8 h-8 rounded-full bg-[#007AFF] flex items-center justify-center"><Mic className="w-4 h-4 text-white" /></div>
              <div className="flex-1">
                <div className="text-xs font-semibold text-[#007AFF]">语音录音已就绪</div>
                <div className="text-[10px] text-gray-400">AI 将在保存时分析此音频</div>
              </div>
              <button onClick={() => setAudio(null)} className="p-1 text-gray-400 hover:text-red-500"><X className="w-4 h-4" /></button>
            </div>
          )}
          {image && (
            <div className="relative rounded-xl overflow-hidden group">
              <img src={image} alt="Upload" className="w-full h-48 object-cover" />
              <button onClick={() => setImage(null)} className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded-full backdrop-blur-md"><X className="w-4 h-4" /></button>
            </div>
          )}
        </section>
        <div className="flex items-center justify-around py-4">
          <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center gap-1 group">
            <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-sm border border-black/5 group-active:bg-gray-50"><ImageIcon className="w-6 h-6 text-[#007AFF]" /></div>
            <span className="text-[10px] text-gray-500 font-medium">照片</span>
            <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
          </button>
          
          <button
            onClick={() => isRecording ? stopRecording() : startRecording()}
            className="flex flex-col items-center gap-1 group select-none"
          >
            <div className={cn("w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all", isRecording ? "bg-red-500 scale-110 animate-pulse" : "bg-white border border-black/5")}>
              <Mic className={cn("w-8 h-8", isRecording ? "text-white" : "text-[#007AFF]")} />
            </div>
            <span className="text-[10px] text-gray-500 font-medium">{isRecording ? "正在录音 (点击停止)" : "点击录音"}</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// --- Main App ---

function ChatDialog({ memos, initialMemo, onClose }: { memos: Memo[]; initialMemo?: Memo | null; onClose: () => void }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([
    { 
      role: 'ai', 
      text: initialMemo 
        ? `你好！我已经准备好和你讨论关于《${initialMemo.title}》的内容了。你可以问我关于这条笔记的任何细节。` 
        : '你好！我是你的 Gemini 笔记助手。你可以问我关于备忘录的任何问题，比如“帮我总结一下最近的会议”或“我上周收藏了哪些关于 AI 的文章？”' 
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chatProgress, setChatProgress] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsLoading(true);
    setChatProgress('正在检索相关笔记...');

    try {
      const apiKey = getApiKey();
      if (!apiKey) throw new Error("API_KEY_MISSING");
      
      setChatProgress('正在思考中...');
      const ai = new GoogleGenAI({ apiKey });
      const model = "gemini-3-flash-preview";

      let systemInstruction = "";
      
      if (initialMemo) {
        // Focused mode for a single memo
        let content = initialMemo.rawText || initialMemo.content;
        if (initialMemo.blocks) {
          content += "\n结构化内容: " + initialMemo.blocks.map(b => {
            const blockContent = Array.isArray(b.content) ? b.content.join(', ') : b.content;
            return `[${b.type}] ${b.title || ''}: ${blockContent}`;
          }).join('; ');
        }
        
        systemInstruction = `你是一个智能笔记助手。你现在的任务是协助用户深入理解当前这条备忘录。
        当前备忘录内容:
        标题: ${initialMemo.title}
        日期: ${new Date(initialMemo.timestamp).toLocaleString()}
        内容: ${content}
        
        你的任务：
        1. 基于上述内容回答用户的任何问题。
        2. 帮助用户挖掘内容中的深层含义或提供延伸建议。
        3. 如果用户问到了其他备忘录的内容，请礼貌地告知你目前正专注于这一条笔记。
        
        回复要求：
        - 语气友好、专业、简洁。
        - 使用 Markdown 格式美化你的回复。`;
      } else {
        // Global RAG Logic: Filter relevant memos
        const keywords = userMsg.toLowerCase().split(/[\s,，。！!？?]+/).filter(k => k.length >= 1);
        
        const scoredMemos = memos.map(m => {
          let score = 0;
          const searchText = (m.title + " " + (m.rawText || m.content) + " " + m.type).toLowerCase();
          
          keywords.forEach(kw => {
            if (searchText.includes(kw)) score += 10;
            if (m.title.toLowerCase().includes(kw)) score += 5;
          });
          
          const hoursOld = (Date.now() - m.timestamp) / (1000 * 60 * 60);
          if (hoursOld < 24) score += 5;
          if (hoursOld < 1) score += 5;

          return { m, score, timestamp: m.timestamp };
        });

        const topByScore = [...scoredMemos].sort((a, b) => b.score - a.score).slice(0, 10);
        const topByRecency = [...scoredMemos].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
        const relevantMemos = Array.from(new Set([...topByScore, ...topByRecency].map(item => item.m)));

        const memosContext = relevantMemos.map(m => {
          let content = m.rawText || m.content;
          if (m.blocks) {
            content += "\n结构化内容: " + m.blocks.map(b => {
              const blockContent = Array.isArray(b.content) ? b.content.join(', ') : b.content;
              return `[${b.type}] ${b.title || ''}: ${blockContent}`;
            }).join('; ');
          }
          return `ID: ${m.id}\n类型: ${m.type}\n标题: ${m.title}\n日期: ${new Date(m.timestamp).toLocaleString()}\n内容: ${content}`;
        }).join('\n---\n');

        systemInstruction = `你是一个智能笔记助手。你拥有用户备忘录库的检索权限。
        当前时间: ${new Date().toLocaleString()}
        
        【检索到的相关备忘录数据】:
        ${memosContext}
        
        你的任务：回答用户关于备忘录的问题，寻找特定信息，进行跨备忘录分析。
        
        回复要求：
        - 语气友好、专业、简洁。
        - 使用 Markdown 格式美化你的回复。`;
      }

      setChatProgress('正在生成回复...');
      const response = await ai.models.generateContent({
        model,
        contents: [
          ...messages.map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.text }]
          })),
          { role: 'user', parts: [{ text: userMsg }] }
        ],
        config: {
          systemInstruction,
        }
      });

      setMessages(prev => [...prev, { role: 'ai', text: response.text || '抱歉，我没能理解你的意思。' }]);
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'ai', text: error.message === 'API_KEY_MISSING' ? '请先在设置中配置 API Key。' : '发生了一些错误，请稍后再试。' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed inset-0 z-[100] bg-[#F2F2F7] flex flex-col"
    >
      <div className="ios-blur sticky top-0 px-4 py-3 flex items-center justify-between">
        <button onClick={onClose} className="text-[#007AFF] text-lg font-medium ios-button">关闭</button>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#007AFF] animate-pulse" />
          问问 Gemini
        </h2>
        <div className="w-12" /> {/* Spacer */}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <div key={idx} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[85%] p-4 rounded-2xl shadow-sm",
              msg.role === 'user' ? "bg-[#007AFF] text-white rounded-tr-none" : "bg-white text-gray-800 rounded-tl-none border border-black/5"
            )}>
              <div className="prose prose-sm prose-slate max-w-none dark:prose-invert">
                <ReactMarkdown>{msg.text}</ReactMarkdown>
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white p-4 rounded-2xl rounded-tl-none border border-black/5 shadow-sm flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-[#007AFF]" />
              <span className="text-xs text-gray-400 font-medium animate-pulse">{chatProgress}</span>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 bg-white border-t border-black/5 pb-10">
        <div className="flex gap-2 bg-black/5 p-2 rounded-2xl">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="问问你的笔记..."
            className="flex-1 bg-transparent px-3 py-2 focus:outline-none text-sm"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="w-10 h-10 bg-[#007AFF] text-white rounded-xl flex items-center justify-center disabled:opacity-30 ios-button"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default function App() {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedMemo, setSelectedMemo] = useState<Memo | null>(null);
  const [isReAnalyzing, setIsReAnalyzing] = useState(false);
  const [reAnalysisProgress, setReAnalysisProgress] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<MemoType | '全部'>('全部');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMemo, setChatMemo] = useState<Memo | null>(null);
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_api_key') || '');

  const [isEditing, setIsEditing] = useState(false);
  const [editMemo, setEditMemo] = useState<Memo | null>(null);

  const [isShareSheetOpen, setIsShareSheetOpen] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  // Load from IndexedDB on mount
  useEffect(() => {
    getAllMemos().then(setMemos).catch(console.error);
  }, []);

  const handleShareAsImage = async (memo: Memo) => {
    setIsShareSheetOpen(false);
    
    try {
      // Create a hidden container for high-quality rendering
      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      container.style.top = '0';
      container.style.width = '750px'; 
      container.style.background = '#F2F2F7'; 
      document.body.appendChild(container);

      const dateStr = new Date(memo.timestamp).toLocaleString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      // Elegant, professional styling for social media sharing
      container.innerHTML = `
        <div style="padding: 60px; font-family: 'Inter', -apple-system, sans-serif; background: #F5F5F0;">
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono&family=Playfair+Display:ital,wght@0,700;1,700&display=swap');
            
            .card-main {
              background: #FDFDFB;
              border-radius: 48px;
              padding: 80px;
              box-shadow: 0 40px 100px rgba(0,0,0,0.05);
              border: 1px solid rgba(0,0,0,0.03);
              overflow: hidden;
              position: relative;
            }

            .header-group {
              margin-bottom: 60px;
              text-align: center;
            }

            .brand-badge {
              display: inline-block;
              background: #1A1A1A;
              color: white;
              padding: 6px 16px;
              border-radius: 100px;
              font-size: 10px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.25em;
              margin-bottom: 30px;
            }

            .memo-title {
              font-family: 'Playfair Display', serif;
              font-size: 56px;
              font-weight: 700;
              margin: 0 0 24px 0;
              color: #1A1A1A;
              line-height: 1.1;
              letter-spacing: -0.03em;
            }

            .memo-meta {
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 20px;
              font-size: 12px;
              color: #AEAEB2;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.1em;
            }

            .insight-section {
              background: white;
              padding: 50px;
              border-radius: 40px;
              margin-bottom: 50px;
              position: relative;
              border: 1px solid rgba(0,0,0,0.03);
              box-shadow: 0 10px 40px rgba(0,0,0,0.02);
            }

            .insight-section::before {
              content: "";
              position: absolute;
              top: 0;
              left: 0;
              width: 6px;
              height: 100%;
              background: #1A1A1A;
              opacity: 0.1;
            }

            .insight-label {
              font-size: 10px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.3em;
              color: #AEAEB2;
              margin-bottom: 20px;
              display: block;
            }

            .insight-text {
              font-family: 'Playfair Display', serif;
              font-style: italic;
              font-size: 26px;
              font-weight: 500;
              line-height: 1.5;
              color: #1A1A1A;
              margin: 0;
              white-space: pre-wrap;
            }

            .blocks-grid {
              display: flex;
              flex-direction: column;
              gap: 30px;
            }

            .block-card {
              border-radius: 32px;
              padding: 45px;
              border: 1px solid rgba(0,0,0,0.03);
              position: relative;
              background: white;
            }

            .block-indent-line {
              position: absolute;
              left: 0;
              top: 0;
              bottom: 0;
              width: 1px;
              background: rgba(0,0,0,0.05);
            }

            /* Block Colors - Refined */
            .block-blue { background: #F0F7FF; }
            .block-emerald { background: #F0FDF4; }
            .block-amber { background: #FFFBEB; }
            .block-violet { background: #F5F3FF; }
            .block-rose { background: #FFF1F2; }
            .block-slate { background: #F8FAFC; }

            .block-header {
              display: flex;
              align-items: center;
              gap: 18px;
              margin-bottom: 24px;
            }

            .block-icon-circle {
              width: 44px;
              height: 44px;
              background: white;
              border-radius: 14px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 22px;
              box-shadow: 0 4px 15px rgba(0,0,0,0.03);
              border: 1px solid rgba(0,0,0,0.02);
            }

            .block-title {
              font-size: 22px;
              font-weight: 800;
              color: #1A1A1A;
              letter-spacing: -0.01em;
            }

            .block-content {
              font-size: 17px;
              color: #3A3A3C;
              line-height: 1.8;
              font-weight: 500;
            }

            .block-content ul {
              padding-left: 24px;
              margin: 0;
              list-style: none;
            }

            .block-content li {
              margin-bottom: 16px;
              position: relative;
            }

            .block-content li::before {
              content: "";
              position: absolute;
              left: -20px;
              top: 12px;
              width: 4px;
              height: 4px;
              border-radius: 50%;
              background: rgba(0,0,0,0.2);
            }

            .todo-list-box {
              margin-top: 30px;
              background: rgba(255,255,255,0.8);
              border-radius: 24px;
              padding: 15px;
              border: 1px solid rgba(0,0,0,0.02);
            }

            .todo-row {
              display: flex;
              padding: 18px 24px;
              border-bottom: 1px solid rgba(0,0,0,0.03);
              align-items: flex-start;
              gap: 18px;
            }
            .todo-row:last-child { border-bottom: none; }

            .todo-check {
              width: 24px;
              height: 24px;
              border: 1px solid #1A1A1A;
              border-radius: 8px;
              flex-shrink: 0;
              margin-top: 2px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 14px;
              color: white;
              background: #1A1A1A;
            }

            .todo-text-main {
              font-size: 17px;
              font-weight: 700;
              color: #1A1A1A;
            }

            .raw-dark-box {
              background: #1A1A1A;
              color: #8E8E93;
              padding: 50px;
              border-radius: 40px;
              font-family: 'JetBrains Mono', monospace;
              font-size: 13px;
              line-height: 1.8;
              white-space: pre-wrap;
              margin-top: 80px;
              position: relative;
            }

            .raw-label {
              position: absolute;
              top: -12px;
              left: 50px;
              background: #3A3A3C;
              color: white;
              padding: 5px 15px;
              border-radius: 8px;
              font-size: 10px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.2em;
            }

            .footer-section {
              margin-top: 100px;
              text-align: center;
              padding-top: 50px;
              border-top: 1px solid rgba(0,0,0,0.05);
            }

            .footer-logo-text {
              font-family: 'Playfair Display', serif;
              font-size: 22px;
              font-weight: 900;
              color: #1A1A1A;
              letter-spacing: 0.05em;
              margin-bottom: 10px;
            }

            .footer-tagline {
              font-size: 10px;
              color: #AEAEB2;
              text-transform: uppercase;
              letter-spacing: 0.4em;
              font-weight: 700;
            }
          </style>
          
          <div class="card-main">
            <div class="header-group">
              <div class="brand-badge">
                <span>${memo.type}</span>
              </div>
              <h1 class="memo-title">${memo.title}</h1>
              <div class="memo-meta">
                <span>${dateStr}</span>
                <span style="opacity: 0.2;">/</span>
                <span>SM-${memo.id.slice(-6).toUpperCase()}</span>
              </div>
            </div>

            ${memo.imageUrl ? `
              <div style="margin-bottom: 60px; border-radius: 40px; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,0.1); border: 1px solid rgba(0,0,0,0.05);">
                <img src="${memo.imageUrl}" style="width: 100%; display: block; grayscale: 0.1;" />
              </div>
            ` : ''}

            ${memo.content ? `
              <div class="insight-section">
                <span class="insight-label">AI Core Insight</span>
                <p class="insight-text">${memo.content}</p>
              </div>
            ` : ''}

            ${memo.blocks ? `
              <div class="blocks-grid">
                ${memo.blocks.map(block => {
                  const icon = block.type === 'todo' ? '✅' : 
                               block.type === 'highlight' ? '💡' :
                               block.type === 'quote' ? '💬' :
                               block.type === 'step' ? '🔢' :
                               block.type === 'bento' ? '🍱' : '📄';
                  const colorClass = 'block-' + (block.color || 'slate');
                  return `
                    <div class="block-card ${colorClass}">
                      <div class="block-indent-line"></div>
                      <div class="block-header">
                        <div class="block-icon-circle">${icon}</div>
                        <div class="block-title">${block.title || block.type.toUpperCase()}</div>
                      </div>
                      <div class="block-content">
                        ${block.type === 'bento' && Array.isArray(block.content) ? `
                          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 10px;">
                            ${block.content.map(item => `
                              <div style="padding: 15px; background: rgba(0,0,0,0.03); border-radius: 12px; font-size: 13px; font-weight: 600;">${item}</div>
                            `).join('')}
                          </div>
                        ` : block.type === 'list' && Array.isArray(block.content) ? `
                          <ul>${block.content.map(line => `<li>${line}</li>`).join('')}</ul>
                        ` : Array.isArray(block.content) ? `
                          ${block.content.map(p => `<p style="margin-bottom: 15px;">${p}</p>`).join('')}
                        ` : `<p>${block.content}</p>`}
                        
                        ${block.todoItems ? `
                          <div class="todo-list-box">
                            ${block.todoItems.map(item => `
                              <div class="todo-row">
                                <div class="todo-check">${item.completed ? '✓' : ''}</div>
                                <div class="todo-text-main">${item.task}</div>
                              </div>
                            `).join('')}
                          </div>
                        ` : ''}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : ''}

            ${memo.rawText ? `
              <div class="raw-dark-box">
                <span class="raw-label">原始记录存档</span>
                ${memo.rawText}
              </div>
            ` : ''}

            <div class="footer-section">
              <div class="footer-logo-text">SMART MEMO AI</div>
              <div class="footer-tagline">Intelligent Capture • Structured Thinking</div>
            </div>
          </div>
        </div>
      `;

      // Wait for fonts and images to load
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(container, {
        scale: 3, 
        useCORS: true,
        backgroundColor: '#F2F2F7',
        logging: false,
        allowTaint: true,
      });

      // Cleanup
      document.body.removeChild(container);

      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], `[${memo.type}]_${memo.title}_${new Date().toISOString().split('T')[0]}.png`, { type: 'image/png' });
        
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: memo.title,
          });
        } else {
          // Fallback: Download
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = file.name;
          a.click();
          URL.revokeObjectURL(url);
        }
      }, 'image/png');
    } catch (error) {
      console.error('Error generating image:', error);
      alert('生成图片失败');
    }
  };

  const handleShare = async (memo: Memo) => {
    setIsShareSheetOpen(true);
  };

  const handleMemoChat = (memo: Memo) => {
    setChatMemo(memo);
    setIsChatOpen(true);
  };

  const handleToggleTodo = async (memoId: string, blockIdx: number, itemIdx: number) => {
    const memo = memos.find(m => m.id === memoId);
    if (!memo || !memo.blocks) return;

    const newBlocks = [...memo.blocks];
    const block = { ...newBlocks[blockIdx] };
    if (block.todoItems) {
      const newItems = [...block.todoItems];
      newItems[itemIdx] = { ...newItems[itemIdx], completed: !newItems[itemIdx].completed };
      block.todoItems = newItems;
      newBlocks[blockIdx] = block;

      const updatedMemo = { ...memo, blocks: newBlocks };
      await saveMemoToDB(updatedMemo);
      setMemos(memos.map(m => m.id === memoId ? updatedMemo : m));
      if (selectedMemo?.id === memoId) {
        setSelectedMemo(updatedMemo);
      }
    }
  };

  const handleSaveMemo = async (newMemo: Memo) => {
    await saveMemoToDB(newMemo);
    setMemos([newMemo, ...memos]);
  };

  const handleDeleteMemo = async (id: string) => {
    await deleteMemoFromDB(id);
    setMemos(memos.filter(m => m.id !== id));
    setSelectedMemo(null);
  };

  const handleSaveEdit = async () => {
    if (!editMemo) return;
    await saveMemoToDB(editMemo);
    setMemos(memos.map(m => m.id === editMemo.id ? editMemo : m));
    setSelectedMemo(editMemo);
    setIsEditing(false);
    setEditMemo(null);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditMemo(null);
  };

  const handleExportData = () => {
    const data = JSON.stringify(memos, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `memos_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedMemos = JSON.parse(event.target?.result as string);
        if (Array.isArray(importedMemos)) {
          if (confirm(`确定要导入 ${importedMemos.length} 条备忘录吗？这可能会覆盖现有数据。`)) {
            for (const m of importedMemos) {
              await saveMemoToDB(m);
            }
            const all = await getAllMemos();
            setMemos(all);
            alert('导入成功');
          }
        }
      } catch (err) {
        alert('导入失败，请检查文件格式');
      }
    };
    reader.readAsText(file);
  };

  const filteredMemos = memos
    .filter(m => {
      const matchesSearch = m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           m.content.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType = filterType === '全部' || m.type === filterType;
      return matchesSearch && matchesType;
    })
    .sort((a, b) => b.timestamp - a.timestamp);

  const handleSaveApiKey = () => {
    localStorage.setItem('gemini_api_key', apiKey);
    setIsSettingsOpen(false);
    alert('API Key 已保存');
  };

  return (
    <div className="min-h-screen max-w-md mx-auto bg-[#F2F2F7] relative overflow-hidden flex flex-col">
      <div className="flex-1 flex flex-col no-print">
        <header className="ios-blur sticky top-0 z-30 px-6 pt-12 pb-4">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold tracking-tight">备忘录</h1>
            <div className="flex gap-3">
              <button onClick={() => setIsSettingsOpen(true)} className="p-2 bg-white rounded-full shadow-sm border border-black/5 ios-button">
                <Settings className="w-5 h-5 text-[#007AFF]" />
              </button>
              <button onClick={() => setIsCreating(true)} className="p-2 bg-[#007AFF] rounded-full shadow-md shadow-[#007AFF]/20 ios-button">
                <Plus className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text" placeholder="搜索" value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black/5 rounded-xl py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 transition-all"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar -mx-2 px-2">
            <button
              onClick={() => setFilterType('全部')}
              className={cn(
                "px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all",
                filterType === '全部' ? "bg-[#007AFF] text-white shadow-sm" : "bg-white text-gray-500 border border-black/5"
              )}
            >
              全部
            </button>
            {MEMO_TYPES.map(t => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={cn(
                  "px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all",
                  filterType === t ? "bg-[#007AFF] text-white shadow-sm" : "bg-white text-gray-500 border border-black/5"
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </header>
        <main className="flex-1 px-4 py-6 overflow-y-auto custom-scrollbar">
          {filteredMemos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-4 shadow-sm border border-black/5"><Plus className="w-8 h-8" /></div>
              <p className="font-medium">暂无备忘录</p>
              <p className="text-sm">点击 + 创建你的第一条笔记</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredMemos.map((memo) => (
                <MemoCard key={memo.id} memo={memo} onClick={() => setSelectedMemo(memo)} />
              ))}
            </div>
          )}
        </main>
        <div className="ios-blur sticky bottom-0 px-6 py-4 flex justify-between items-center no-print border-t border-black/5">
          <p className="text-xs text-gray-400 font-medium">{memos.length} 条备忘录</p>
          <button 
            onClick={() => setIsChatOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-black/5 rounded-full shadow-sm text-[#007AFF] text-xs font-bold ios-button"
          >
            <div className="w-2 h-2 rounded-full bg-[#007AFF] animate-pulse" />
            问问 Gemini
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isSettingsOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold">设置</h3>
                <button onClick={() => setIsSettingsOpen(false)}><X className="w-6 h-6 text-gray-400" /></button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Gemini API Key</label>
                  <input
                    type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                    placeholder="输入你的 API Key"
                    className="w-full bg-gray-100 rounded-xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20"
                  />
                  <p className="mt-2 text-[10px] text-gray-400">该 Key 将仅保存在你的浏览器本地，用于在 GitHub Pages 等静态环境中使用。</p>
                </div>
                <button onClick={handleSaveApiKey} className="w-full bg-[#007AFF] text-white py-3 rounded-xl font-bold shadow-lg shadow-[#007AFF]/20 active:scale-95 transition-transform">保存设置</button>
                
                <div className="pt-4 border-t border-gray-100 space-y-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">数据备份 (iCloud/本地)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={handleExportData}
                      className="bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-medium ios-button"
                    >
                      导出备份
                    </button>
                    <label className="bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-medium ios-button text-center cursor-pointer">
                      导入备份
                      <input type="file" accept=".json" onChange={handleImportData} className="hidden" />
                    </label>
                  </div>
                  <p className="text-[10px] text-gray-400">
                    你可以将导出的文件保存到 iPhone 的“文件” App 中（即 iCloud 云盘），实现跨设备备份。
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedMemo && (
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-0 z-40 bg-white flex flex-col"
          >
            <div className="ios-blur sticky top-0 px-4 py-3 flex items-center justify-between">
              <button onClick={() => setSelectedMemo(null)} className="flex items-center text-[#007AFF] text-lg font-medium ios-button"><ChevronLeft className="w-6 h-6" />返回</button>
              <div className="flex gap-4">
                {isEditing ? (
                  <>
                    <button onClick={handleSaveEdit} className="flex items-center gap-1 px-3 py-1.5 bg-[#007AFF] text-white rounded-full text-xs font-bold ios-button">
                      <Check className="w-4 h-4" />
                      保存
                    </button>
                    <button onClick={handleCancelEdit} className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-500 rounded-full text-xs font-bold ios-button">
                      <X className="w-4 h-4" />
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button 
                      onClick={() => {
                        setEditMemo(selectedMemo);
                        setIsEditing(true);
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 bg-white border border-black/5 text-gray-500 rounded-full text-xs font-bold ios-button"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      编辑文字
                    </button>
                    <button 
                      onClick={async () => {
                    if (!selectedMemo || isReAnalyzing) return;
                    setIsReAnalyzing(true);
                    setReAnalysisProgress('准备重新分析...');
                    try {
                      setReAnalysisProgress('AI 正在深度思考...');
                      const analysis = await analyzeMemo(
                        selectedMemo.type, 
                        selectedMemo.rawText || selectedMemo.content, 
                        selectedMemo.imageUrl || undefined, 
                        selectedMemo.audioUrl || undefined
                      );
                      setReAnalysisProgress('正在更新笔记...');
                      const updatedMemo = {
                        ...selectedMemo,
                        title: analysis.title,
                        content: analysis.summary || "",
                        blocks: analysis.blocks,
                      };
                      await saveMemoToDB(updatedMemo);
                      setMemos(memos.map(m => m.id === selectedMemo.id ? updatedMemo : m));
                      setSelectedMemo(updatedMemo);
                      setReAnalysisProgress('完成！');
                    } catch (err: any) {
                      alert(`重分析失败: ${err.message}`);
                    } finally {
                      setIsReAnalyzing(false);
                      setReAnalysisProgress('');
                    }
                  }}
                  disabled={isReAnalyzing}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all ios-button",
                    isReAnalyzing ? "bg-[#007AFF]/10 text-[#007AFF]" : "bg-white border border-black/5 text-gray-500"
                  )}
                >
                  {isReAnalyzing ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span className="animate-pulse">{reAnalysisProgress}</span>
                    </>
                  ) : (
                    <>
                      <div className="w-1.5 h-1.5 rounded-full bg-[#007AFF]" />
                      AI 重新整理
                    </>
                  )}
                </button>
                <button onClick={() => handleShare(selectedMemo)} className="ios-button"><Share className="w-5 h-5 text-[#007AFF]" /></button>
                <button onClick={() => handleDeleteMemo(selectedMemo.id)} className="ios-button"><Trash2 className="w-5 h-5 text-red-500" /></button>
                  </>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8 print-content bg-[#FDFDFB]" ref={printRef}>
              <div className="max-w-2xl mx-auto">
                {isEditing && editMemo ? (
                  <div className="space-y-10 pb-20">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">标题</label>
                      <input 
                        value={editMemo.title}
                        onChange={(e) => setEditMemo({ ...editMemo, title: e.target.value })}
                        className="w-full text-3xl font-serif font-bold bg-transparent border-b border-black/5 focus:border-[#007AFF] focus:outline-none pb-2"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">AI 核心总结</label>
                      <textarea 
                        value={editMemo.content}
                        onChange={(e) => setEditMemo({ ...editMemo, content: e.target.value })}
                        className="w-full text-lg font-serif italic bg-white p-6 rounded-2xl border border-black/5 focus:border-[#007AFF] focus:outline-none min-h-[120px] resize-none"
                      />
                    </div>

                    <div className="space-y-8">
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em] border-b border-black/5 pb-2">结构化内容编辑</h4>
                      {editMemo.blocks?.map((block, bIdx) => (
                        <div key={bIdx} className="p-6 bg-white rounded-3xl border border-black/5 space-y-4 shadow-sm">
                          <div className="flex items-center justify-between">
                            <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-[9px] font-bold rounded uppercase tracking-wider">{block.type}</span>
                            <input 
                              value={block.title || ''}
                              onChange={(e) => {
                                const newBlocks = [...editMemo.blocks!];
                                newBlocks[bIdx] = { ...block, title: e.target.value };
                                setEditMemo({ ...editMemo, blocks: newBlocks });
                              }}
                              placeholder="块标题"
                              className="bg-transparent text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right focus:outline-none border-b border-transparent focus:border-[#007AFF]"
                            />
                          </div>
                          
                          {block.type === 'todo' ? (
                            <div className="space-y-3">
                              {block.todoItems?.map((item, iIdx) => (
                                <div key={iIdx} className="space-y-2 p-3 bg-gray-50 rounded-xl border border-black/5">
                                  <input 
                                    value={item.task}
                                    onChange={(e) => {
                                      const newBlocks = [...editMemo.blocks!];
                                      const newItems = [...block.todoItems!];
                                      newItems[iIdx] = { ...item, task: e.target.value };
                                      newBlocks[bIdx] = { ...block, todoItems: newItems };
                                      setEditMemo({ ...editMemo, blocks: newBlocks });
                                    }}
                                    className="w-full text-sm font-medium bg-transparent focus:outline-none"
                                  />
                                  <div className="flex gap-2">
                                    <input 
                                      value={item.time || ''}
                                      onChange={(e) => {
                                        const newBlocks = [...editMemo.blocks!];
                                        const newItems = [...block.todoItems!];
                                        newItems[iIdx] = { ...item, time: e.target.value };
                                        newBlocks[bIdx] = { ...block, todoItems: newItems };
                                        setEditMemo({ ...editMemo, blocks: newBlocks });
                                      }}
                                      placeholder="时间"
                                      className="text-[9px] font-bold text-gray-400 bg-white px-2 py-1 rounded border border-black/5 focus:outline-none"
                                    />
                                    <input 
                                      value={item.notes || ''}
                                      onChange={(e) => {
                                        const newBlocks = [...editMemo.blocks!];
                                        const newItems = [...block.todoItems!];
                                        newItems[iIdx] = { ...item, notes: e.target.value };
                                        newBlocks[bIdx] = { ...block, todoItems: newItems };
                                        setEditMemo({ ...editMemo, blocks: newBlocks });
                                      }}
                                      placeholder="备注"
                                      className="flex-1 text-[10px] text-gray-500 bg-white px-2 py-1 rounded border border-black/5 focus:outline-none"
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <textarea 
                              value={Array.isArray(block.content) ? block.content.join('\n') : block.content}
                              onChange={(e) => {
                                const newBlocks = [...editMemo.blocks!];
                                newBlocks[bIdx] = { ...block, content: e.target.value.split('\n') };
                                setEditMemo({ ...editMemo, blocks: newBlocks });
                              }}
                              className="w-full text-sm text-gray-700 leading-relaxed bg-gray-50 p-4 rounded-2xl border border-black/5 focus:border-[#007AFF] focus:outline-none min-h-[100px] resize-none"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-10 no-print">
                  <div className="flex items-center gap-3">
                    <span className="px-3 py-1 bg-[#1A1A1A] text-white text-[9px] font-bold rounded-full uppercase tracking-[0.2em]">{selectedMemo.type}</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{new Date(selectedMemo.timestamp).toLocaleDateString('zh-CN')}</span>
                  </div>
                  <div className="h-[1px] flex-1 bg-black/5 mx-6" />
                  <div className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">SM-${selectedMemo.id.slice(-6).toUpperCase()}</div>
                </div>
                
                <h2 className="text-4xl font-serif font-bold mb-10 text-[#1A1A1A] leading-tight tracking-tight">{selectedMemo.title}</h2>
                
                {selectedMemo.imageUrl && (
                  <div className="mb-12 rounded-3xl overflow-hidden shadow-2xl shadow-black/5 border border-black/5">
                    <img 
                      src={selectedMemo.imageUrl} 
                      alt="Memo" 
                      className="w-full grayscale-[0.1] hover:grayscale-0 transition-all duration-700" 
                      crossOrigin="anonymous"
                    />
                  </div>
                )}

                {selectedMemo.blocks && selectedMemo.content && (
                  <div className="mb-12 p-10 bg-white rounded-[2.5rem] border border-black/[0.03] shadow-[0_10px_40px_rgba(0,0,0,0.02)] relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-[#1A1A1A]/10" />
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.3em] mb-6">AI Core Insight</h4>
                    <p className="text-xl font-serif italic text-[#1A1A1A] leading-relaxed">{selectedMemo.content}</p>
                  </div>
                )}

                {selectedMemo.rawText && selectedMemo.type === '好文收藏' && (
                  <div className="mb-12 p-8 bg-[#F8F8F5] rounded-3xl border border-black/5">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Original Archive</h4>
                    <p className="text-sm text-gray-600 line-clamp-[10] overflow-y-auto max-h-64 leading-relaxed font-medium">{selectedMemo.rawText}</p>
                  </div>
                )}

                <div className="mb-16">
                  {selectedMemo.blocks ? (
                    <StructuredRenderer 
                      blocks={selectedMemo.blocks} 
                      onToggleTodo={(bIdx, iIdx) => handleToggleTodo(selectedMemo.id, bIdx, iIdx)} 
                    />
                  ) : (
                    <div className="prose prose-slate max-w-none font-medium text-gray-700 leading-relaxed">
                      <ReactMarkdown>{selectedMemo.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
                
                {selectedMemo.audioUrl && (
                  <div className="mb-12 no-print p-6 bg-white rounded-3xl border border-black/5 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Audio Recording</span>
                    </div>
                    <audio controls src={selectedMemo.audioUrl} className="w-full" />
                  </div>
                )}

                {selectedMemo.rawText && selectedMemo.type !== '好文收藏' && (
                  <div className="mt-20 pt-10 border-t border-black/5 no-print">
                    <div className="flex items-center gap-4 mb-6">
                      <h4 className="text-[10px] font-bold text-gray-300 uppercase tracking-[0.2em] whitespace-nowrap">Raw Input Archive</h4>
                      <div className="h-[1px] flex-1 bg-black/5" />
                    </div>
                    <p className="text-sm text-gray-400 italic leading-relaxed font-medium">{selectedMemo.rawText}</p>
                  </div>
                )}
              </>
            )}
            {!isEditing && (
                  <div className="h-20" />
                )}
              </div>
            </div>
            {!isEditing && (
              <div className="ios-blur sticky bottom-0 px-6 py-4 flex justify-between items-center no-print border-t border-black/5">
                <p className="text-xs text-gray-400 font-medium">针对此备忘录提问</p>
                <button 
                  onClick={() => handleMemoChat(selectedMemo)}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-black/5 rounded-full shadow-sm text-[#007AFF] text-xs font-bold ios-button"
                >
                  <div className="w-2 h-2 rounded-full bg-[#007AFF] animate-pulse" />
                  问问这条笔记
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Share Action Sheet */}
      <AnimatePresence>
        {isShareSheetOpen && selectedMemo && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsShareSheetOpen(false)}
              className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm no-print"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed bottom-0 left-0 right-0 z-[80] bg-[#F2F2F7] rounded-t-3xl p-6 pb-10 no-print"
            >
              <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mb-6" />
              <h3 className="text-center text-sm font-semibold text-gray-500 mb-6">分享备忘录</h3>
              
              <div className="space-y-3">
                <button
                  onClick={() => handleShareAsImage(selectedMemo)}
                  className="w-full bg-white py-4 rounded-2xl font-semibold text-[#007AFF] shadow-sm active:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                >
                  <ImageIcon className="w-5 h-5" />
                  分享为长图
                </button>
                <button
                  onClick={() => setIsShareSheetOpen(false)}
                  className="w-full bg-white py-4 rounded-2xl font-semibold text-gray-900 shadow-sm active:bg-gray-50 transition-colors mt-4"
                >
                  取消
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isChatOpen && (
          <ChatDialog 
            memos={memos} 
            initialMemo={chatMemo} 
            onClose={() => {
              setIsChatOpen(false);
              setChatMemo(null);
            }} 
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCreating && <MemoCreator onClose={() => setIsCreating(false)} onSave={handleSaveMemo} />}
      </AnimatePresence>
    </div>
  );
}
