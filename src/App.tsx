import React, { useState, useEffect, useRef } from 'react';
import { Plus, Search, Settings, ChevronLeft, Trash2, Share, X, Mic, Image as ImageIcon, Type as TypeIcon, Loader2, Clock, Calendar, ChevronRight } from 'lucide-react';
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

  let systemInstruction = `你是一位顶级的视觉化笔记与任务管理专家。你的任务是将用户的输入整理成极其结构化、视觉化的笔记。
  你必须根据内容逻辑，将笔记拆分为不同的“块(blocks)”。
  
  ${currentTimeContext}
  请利用上述当前时间背景，智能解析用户提到的相对时间（如“明天”、“下周一”、“后天晚上”等）。

  **核心原则：严禁虚构内容 (STRICT NO HALLUCINATION)**
  - 你只能基于用户提供的文字、图片或语音内容进行整理。
  - **严禁生成用户未提及的任务、计划、待办事项或未来行动**。
  - 除非是“任务清单”或“会议纪要”类型且内容中确实包含明确的任务，否则禁止使用 "todo" 块。
  - 对于“好文收藏”，你的目标是“理解”和“分析”现有的内容精髓，**绝对禁止**虚构“后续计划”或“学习建议”。

  可用块类型：
  1. "todo": 仅用于内容中明确提到的任务。必须按类别归类。
  2. "highlight": 用于核心金句、最重要的结论或定义。
  3. "quote": 用于摘录原文/原图中的精彩片段。
  4. "step": 用于有先后顺序的步骤、逻辑推导或时间线。
  5. "bento": 用于并列的多个要点、分类说明，适合网格展示。
  6. "text": 用于普通的段落描述。

  任务清单(todo)要求：
  - 必须包含：任务内容(task)、预计时间(time)、注意要点(notes)。
  - **时间格式(time)**：必须包含具体的日期、星期几和时间。格式示例：“2026年3月1日 周日 14:00”。
  - 初始状态 completed 必须为 false。
  - 必须根据任务性质归类到合适的标题下。

  颜色分配建议：
  - 蓝色(blue): 逻辑、技术、会议
  - 绿色(emerald): 健身、成功、积极
  - 黄色(amber): 灵感、重点、饭局
  - 紫色(violet): 创意、深度、娱乐
  - 红色(rose): 紧急、生活、碰面
  
  请务必使用中文回复，并严格遵守 JSON 格式。`;

  // ... (rest of the system instruction logic remains similar but adapted for blocks)
  switch (type) {
    case '灵感记录':
      systemInstruction += `\n重点：使用 highlight 块展示核心灵感，使用 bento 块展示应用场景。`;
      break;
    case '会议纪要':
      systemInstruction += `\n重点：使用 todo 块展示待办事项，使用 step 块展示会议流程。`;
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
            summary: { type: Type.STRING, description: "一句话总结" },
            blocks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, enum: ["highlight", "step", "bento", "text", "list", "todo", "quote"] },
                  title: { type: Type.STRING },
                  content: { 
                    type: Type.ARRAY, 
                    items: { type: Type.STRING },
                    description: "内容数组"
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
                required: ["type"]
              }
            }
          },
          required: ["title", "blocks"]
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
    <div className="space-y-6">
      {blocks.map((block, idx) => {
        if (!block) return null;
        
        const colorClasses = {
          blue: "bg-blue-50 border-blue-100 text-blue-900",
          emerald: "bg-emerald-50 border-emerald-100 text-emerald-900",
          amber: "bg-amber-50 border-amber-100 text-amber-900",
          violet: "bg-violet-50 border-violet-100 text-violet-900",
          rose: "bg-rose-50 border-rose-100 text-rose-900",
          slate: "bg-slate-50 border-slate-100 text-slate-900",
        }[block.color || 'slate'];

        const dotColor = {
          blue: "bg-blue-500",
          emerald: "bg-emerald-500",
          amber: "bg-amber-500",
          violet: "bg-violet-500",
          rose: "bg-rose-500",
          slate: "bg-slate-500",
        }[block.color || 'slate'];

        const contentArray = ensureArray(block.content);

        switch (block.type) {
          case 'todo':
            return (
              <div key={idx} className="space-y-3">
                {block.title && <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <span className={cn("w-1.5 h-3 rounded-full", dotColor)} />
                  {block.title}
                </h4>}
                <div className="space-y-2">
                  {block.todoItems?.map((item, iIdx) => (
                    <div 
                      key={iIdx} 
                      onClick={() => onToggleTodo?.(idx, iIdx)}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-2xl border transition-all cursor-pointer",
                        item.completed ? "bg-gray-50 border-gray-100 opacity-60" : "bg-white border-black/5 shadow-sm active:scale-[0.98]"
                      )}
                    >
                      <div className={cn(
                        "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors",
                        item.completed ? "bg-[#007AFF] border-[#007AFF]" : "border-gray-300"
                      )}>
                        {item.completed && <div className="w-2.5 h-1.5 border-l-2 border-b-2 border-white -rotate-45 mb-0.5" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-start gap-2">
                          <span className={cn("text-sm font-semibold leading-snug", item.completed && "line-through text-gray-400")}>
                            {item.task}
                          </span>
                          {item.time && <span className="text-[10px] font-bold text-[#007AFF] bg-[#007AFF]/5 px-1.5 py-0.5 rounded uppercase">{item.time}</span>}
                        </div>
                        {item.notes && <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{item.notes}</p>}
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
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className={cn("p-6 rounded-3xl border shadow-sm", colorClasses)}
              >
                {block.title && <h4 className="text-[10px] font-bold uppercase tracking-widest mb-2 opacity-60">{block.title}</h4>}
                <p className="text-xl font-bold leading-relaxed">{contentArray[0]}</p>
              </motion.div>
            );
          case 'quote':
            return (
              <div key={idx} className="relative p-6 bg-gray-50 rounded-3xl border-l-4 border-[#007AFF] italic text-gray-700">
                <div className="absolute -top-3 -left-1 text-4xl text-[#007AFF] opacity-20 font-serif">“</div>
                <p className="text-base leading-relaxed">{contentArray[0]}</p>
                <div className="absolute -bottom-6 -right-2 text-4xl text-[#007AFF] opacity-20 font-serif">”</div>
              </div>
            );
          case 'step':
            return (
              <div key={idx} className="space-y-4 relative pl-8 py-2">
                <div className="absolute left-[11px] top-4 bottom-4 w-0.5 bg-gray-200" />
                {contentArray.map((step, sIdx) => (
                  <div key={sIdx} className="relative">
                    <div className={cn("absolute -left-[25px] top-1.5 w-3 h-3 rounded-full border-2 border-white shadow-sm", dotColor)} />
                    <p className="text-sm font-medium text-gray-700 leading-relaxed">{step}</p>
                  </div>
                ))}
              </div>
            );
          case 'bento':
            return (
              <div key={idx} className="grid grid-cols-2 gap-3">
                {contentArray.map((item, bIdx) => (
                  <div key={bIdx} className={cn("p-4 rounded-2xl border flex flex-col justify-center min-h-[80px]", colorClasses)}>
                    <p className="text-xs font-bold leading-snug">{item}</p>
                  </div>
                ))}
              </div>
            );
          case 'list':
            return (
              <ul key={idx} className="space-y-3">
                {contentArray.map((item, lIdx) => (
                  <li key={lIdx} className="flex items-start gap-3 text-sm text-gray-600">
                    <span className={cn("mt-1.5 w-1.5 h-1.5 rounded-full shrink-0", dotColor)} />
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            );
          default:
            return <p key={idx} className="text-sm text-gray-600 leading-relaxed">{contentArray[0]}</p>;
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
      className="ios-card p-4 mb-4 cursor-pointer active:scale-[0.98] transition-transform"
    >
      <div className="flex justify-between items-start mb-2">
        <span className="px-2 py-0.5 bg-[#007AFF]/10 text-[#007AFF] text-[10px] font-bold rounded uppercase tracking-wider">
          {memo.type}
        </span>
        <div className="flex items-center gap-1 text-gray-400 text-[10px]">
          <Clock className="w-3 h-3" />
          {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
      <h3 className="text-lg font-bold text-gray-900 mb-1 line-clamp-1">{memo.title}</h3>
      <div className="text-sm text-gray-600 line-clamp-3 mb-3 prose prose-sm">
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
        <div className="mb-3 rounded-lg overflow-hidden h-24">
          <img src={memo.imageUrl} alt="Memo" className="w-full h-full object-cover" />
        </div>
      )}
      <div className="flex items-center justify-between pt-3 border-t border-black/5">
        <div className="flex items-center gap-1 text-gray-400 text-[10px] font-medium">
          <Calendar className="w-3 h-3" />
          {date.toLocaleDateString('zh-CN')}
        </div>
        <ChevronRight className="w-4 h-4 text-gray-300" />
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

function ChatDialog({ memos, onClose }: { memos: Memo[]; onClose: () => void }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([
    { role: 'ai', text: '你好！我是你的 Gemini 笔记助手。你可以问我关于备忘录的任何问题，比如“帮我总结一下最近的会议”或“我上周收藏了哪些关于 AI 的文章？”' }
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

      // --- RAG Logic: Filter relevant memos ---
      const keywords = userMsg.toLowerCase().split(/[\s,，。！!？?]+/).filter(k => k.length >= 1);
      
      const scoredMemos = memos.map(m => {
        let score = 0;
        const searchText = (m.title + " " + (m.rawText || m.content) + " " + m.type).toLowerCase();
        
        // Keyword matching score
        keywords.forEach(kw => {
          if (searchText.includes(kw)) score += 10;
          if (m.title.toLowerCase().includes(kw)) score += 5;
        });
        
        // Recency boost (memos from last 24h get a boost)
        const hoursOld = (Date.now() - m.timestamp) / (1000 * 60 * 60);
        if (hoursOld < 24) score += 5;
        if (hoursOld < 1) score += 5; // Very recent

        return { m, score, timestamp: m.timestamp };
      });

      // Pick top 10 by score + top 5 by recency (to ensure context of what user just did)
      const topByScore = [...scoredMemos].sort((a, b) => b.score - a.score).slice(0, 10);
      const topByRecency = [...scoredMemos].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
      
      // Merge and deduplicate
      const relevantMemos = Array.from(new Set([...topByScore, ...topByRecency].map(item => item.m)));

      // Prepare pruned context
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

      const systemInstruction = `你是一个智能笔记助手。你拥有用户备忘录库的检索权限。
      当前时间: ${new Date().toLocaleString()}
      
      【检索到的相关备忘录数据】(已根据相关性和时间为你筛选):
      ${memosContext}
      
      你的任务：
      1. 回答用户关于备忘录的问题。
      2. 帮用户寻找特定的信息或备忘录。
      3. 进行跨备忘录的深度分析、总结或对比。
      
      回复要求：
      - 语气友好、专业、简洁。
      - 如果检索到的信息中没有相关内容，请诚实告知，并建议用户尝试提供更多关键词。
      - 使用 Markdown 格式美化你的回复。
      - 如果提到了具体的备忘录，请指明其标题。`;

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
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_api_key') || '');

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
      container.style.width = '800px'; // Fixed width for consistent layout
      container.style.background = 'white';
      document.body.appendChild(container);

      const dateStr = new Date(memo.timestamp).toLocaleString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      // Reuse the beautiful styling logic
      container.innerHTML = `
        <div style="padding: 60px; font-family: 'Inter', -apple-system, sans-serif; color: #1C1C1E; line-height: 1.6;">
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono&family=Playfair+Display:ital,wght@0,700;1,700&display=swap');
            .report-header {
              border-left: 8px solid #007AFF;
              padding: 20px 0 20px 30px;
              margin-bottom: 50px;
              background: linear-gradient(to right, #f0f7ff, transparent);
            }
            .type-label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.15em; color: #007AFF; margin-bottom: 8px; display: block; }
            h1 { font-family: 'Playfair Display', serif; font-size: 38px; font-weight: 700; margin: 0; color: #141414; line-height: 1.1; }
            .meta-bar { display: flex; justify-content: space-between; margin-top: 20px; padding-top: 20px; border-top: 1px solid #E5E5EA; font-size: 12px; color: #8E8E93; }
            .section { margin-bottom: 60px; }
            .section-header { display: flex; align-items: baseline; gap: 15px; margin-bottom: 25px; }
            .section-num { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #007AFF; font-weight: 700; opacity: 0.6; }
            .section-title { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: #636366; }
            .section-line { flex: 1; height: 1px; background: #E5E5EA; }
            .summary-box { background: #F8F9FA; border-radius: 20px; padding: 35px; position: relative; }
            .summary-text { font-size: 18px; font-weight: 500; color: #1C1C1E; line-height: 1.7; white-space: pre-wrap; }
            .block-card { border: 1px solid #E5E5EA; border-radius: 24px; padding: 30px; margin-bottom: 30px; background: white; }
            .block-head { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
            .block-icon { width: 36px; height: 36px; background: #f0f7ff; color: #007AFF; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; }
            .block-title { font-size: 20px; font-weight: 700; color: #141414; }
            .block-body { font-size: 15px; color: #333; }
            .block-body ul { padding-left: 20px; margin: 0; }
            .block-body li { margin-bottom: 10px; }
            .todo-box { margin-top: 25px; background: #fff; border: 1px solid #E5E5EA; border-radius: 16px; overflow: hidden; }
            .todo-row { display: flex; padding: 15px 20px; border-bottom: 1px solid #E5E5EA; align-items: flex-start; gap: 15px; }
            .todo-check { width: 20px; height: 20px; border: 2px solid #007AFF; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #007AFF; margin-top: 2px; flex-shrink: 0; }
            .todo-task { font-weight: 600; font-size: 15px; }
            .raw-wrapper { background: #1c1c1e; color: #d1d1d6; padding: 40px; border-radius: 24px; font-family: 'JetBrains Mono', monospace; font-size: 13px; line-height: 1.8; white-space: pre-wrap; }
            .footer { margin-top: 80px; text-align: center; font-size: 10px; color: #8E8E93; text-transform: uppercase; letter-spacing: 0.1em; border-top: 1px solid #E5E5EA; padding-top: 20px; }
          </style>
          
          <div class="report-header">
            <span class="type-label">${memo.type}</span>
            <h1>${memo.title}</h1>
            <div class="meta-bar">
              <span>日期：${dateStr}</span>
              <span>文档编号：SM-${memo.id.slice(-6).toUpperCase()}</span>
            </div>
          </div>

          ${memo.imageUrl ? `<div style="margin-bottom: 50px; border-radius: 24px; overflow: hidden;"><img src="${memo.imageUrl}" style="width: 100%; display: block;" /></div>` : ''}

          ${memo.content ? `
            <div class="section">
              <div class="section-header">
                <span class="section-num">01</span>
                <span class="section-title">AI 核心总结</span>
                <div class="section-line"></div>
              </div>
              <div class="summary-box">
                <div class="summary-text">${memo.content}</div>
              </div>
            </div>
          ` : ''}

          ${memo.blocks ? `
            <div class="section">
              <div class="section-header">
                <span class="section-num">02</span>
                <span class="section-title">结构化深度分析</span>
                <div class="section-line"></div>
              </div>
              <div class="blocks-container">
                ${memo.blocks.map(block => {
                  const icon = block.type === 'todo' ? '✅' : 
                               block.type === 'highlight' ? '💡' :
                               block.type === 'quote' ? '💬' :
                               block.type === 'step' ? '🔢' :
                               block.type === 'bento' ? '🍱' : '📄';
                  return `
                    <div class="block-card">
                      <div class="block-head">
                        <div class="block-icon">${icon}</div>
                        <div class="block-title">${block.title || block.type.toUpperCase()}</div>
                      </div>
                      <div class="block-body">
                        ${Array.isArray(block.content) ? `
                          <ul>${block.content.map(line => `<li>${line}</li>`).join('')}</ul>
                        ` : `<p>${block.content}</p>`}
                        
                        ${block.todoItems ? `
                          <div class="todo-box">
                            ${block.todoItems.map(item => `
                              <div class="todo-row">
                                <div class="todo-check">${item.completed ? '✓' : ''}</div>
                                <div class="todo-content">
                                  <div class="todo-task">${item.task}</div>
                                </div>
                              </div>
                            `).join('')}
                          </div>
                        ` : ''}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          ` : ''}

          ${memo.rawText ? `
            <div class="section">
              <div class="section-header">
                <span class="section-num">03</span>
                <span class="section-title">原始记录存档</span>
                <div class="section-line"></div>
              </div>
              <div class="raw-wrapper">${memo.rawText}</div>
            </div>
          ` : ''}

          <div class="footer">
            Smart Memo AI Assistant • Generated with Intelligence
          </div>
        </div>
      `;

      // Wait for fonts and images to load
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(container, {
        scale: 2, // Higher scale for better quality
        useCORS: true,
        backgroundColor: '#ffffff',
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

  const handlePrintToPDF = (memo: Memo) => {
    setIsShareSheetOpen(false);
    
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) return;

    const dateStr = new Date(memo.timestamp).toLocaleString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>[${memo.type}] ${memo.title}</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono&family=Playfair+Display:ital,wght@0,700;1,700&display=swap" rel="stylesheet">
        <style>
          :root {
            --primary: #007AFF;
            --primary-dark: #0056b3;
            --primary-light: #f0f7ff;
            --accent: #5856D6;
            --bg-soft: #F8F9FA;
            --text-main: #1C1C1E;
            --text-muted: #636366;
            --text-light: #8E8E93;
            --border: #E5E5EA;
            --ink: #141414;
          }
          
          @media print {
            @page { 
              margin: 1.5cm; 
              size: A4;
            }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }

          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            line-height: 1.6;
            color: var(--text-main);
            padding: 0;
            margin: 0;
            background: white;
          }

          .container {
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
          }

          /* Header Section */
          .report-header {
            border-left: 8px solid var(--primary);
            padding: 20px 0 20px 30px;
            margin-bottom: 50px;
            background: linear-gradient(to right, var(--primary-light), transparent);
          }

          .type-label {
            font-family: 'Inter';
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.15em;
            color: var(--primary);
            margin-bottom: 8px;
            display: block;
          }

          h1 {
            font-family: 'Playfair Display', serif;
            font-size: 38px;
            font-weight: 700;
            margin: 0;
            color: var(--ink);
            line-height: 1.1;
          }

          .meta-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid var(--border);
            font-size: 12px;
            color: var(--text-light);
            font-weight: 500;
          }

          /* Section Styling */
          .section {
            margin-bottom: 60px;
            position: relative;
          }

          .section-header {
            display: flex;
            align-items: baseline;
            gap: 15px;
            margin-bottom: 25px;
          }

          .section-num {
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            color: var(--primary);
            font-weight: 700;
            opacity: 0.6;
          }

          .section-title {
            font-size: 13px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: var(--text-muted);
          }

          .section-line {
            flex: 1;
            height: 1px;
            background: var(--border);
          }

          /* Summary Card */
          .summary-box {
            background: var(--bg-soft);
            border-radius: 20px;
            padding: 35px;
            position: relative;
            overflow: hidden;
          }

          .summary-box::before {
            content: '"';
            position: absolute;
            top: -20px;
            left: 20px;
            font-family: 'Playfair Display';
            font-size: 120px;
            color: var(--primary);
            opacity: 0.08;
          }

          .summary-text {
            font-size: 18px;
            font-weight: 500;
            color: var(--text-main);
            line-height: 1.7;
            position: relative;
            z-index: 1;
            white-space: pre-wrap;
          }

          /* Block Cards */
          .blocks-container {
            display: grid;
            gap: 30px;
          }

          .block-card {
            border: 1px solid var(--border);
            border-radius: 24px;
            padding: 30px;
            page-break-inside: avoid;
            transition: all 0.2s ease;
          }

          .block-head {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 20px;
          }

          .block-icon {
            width: 36px;
            height: 36px;
            background: var(--primary-light);
            color: var(--primary);
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
          }

          .block-title {
            font-size: 20px;
            font-weight: 700;
            color: var(--ink);
          }

          .block-body {
            font-size: 15px;
            color: #333;
          }

          .block-body ul {
            padding-left: 20px;
            margin: 0;
          }

          .block-body li {
            margin-bottom: 10px;
          }

          /* Todo List */
          .todo-box {
            margin-top: 25px;
            background: #fff;
            border: 1px solid var(--border);
            border-radius: 16px;
            overflow: hidden;
          }

          .todo-row {
            display: flex;
            padding: 15px 20px;
            border-bottom: 1px solid var(--border);
            align-items: flex-start;
            gap: 15px;
          }

          .todo-row:last-child { border-bottom: none; }

          .todo-check {
            width: 20px;
            height: 20px;
            border: 2px solid var(--primary);
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            color: var(--primary);
            margin-top: 2px;
            flex-shrink: 0;
          }

          .todo-content { flex: 1; }

          .todo-task { font-weight: 600; font-size: 15px; }

          .todo-meta {
            display: flex;
            gap: 15px;
            margin-top: 5px;
            font-size: 12px;
            color: var(--text-light);
          }

          /* Raw Text Section */
          .raw-section {
            margin-top: 80px;
            page-break-before: always;
          }

          .raw-header {
            font-family: 'JetBrains Mono';
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.2em;
            color: var(--text-light);
            margin-bottom: 20px;
            display: block;
            text-align: center;
          }

          .raw-wrapper {
            background: #1c1c1e;
            color: #d1d1d6;
            padding: 40px;
            border-radius: 24px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 13px;
            line-height: 1.8;
            white-space: pre-wrap;
          }

          /* Image Handling */
          .image-container {
            margin-bottom: 50px;
            border-radius: 24px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
          }

          .image-container img {
            width: 100%;
            display: block;
          }

          .footer {
            margin-top: 80px;
            padding-top: 30px;
            border-top: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            color: var(--text-light);
            text-transform: uppercase;
            letter-spacing: 0.1em;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <header class="report-header">
            <span class="type-label">${memo.type}</span>
            <h1>${memo.title}</h1>
            <div class="meta-bar">
              <span>日期：${dateStr}</span>
              <span>文档编号：SM-${memo.id.slice(-6).toUpperCase()}</span>
            </div>
          </header>

          ${memo.imageUrl ? `
            <div class="image-container">
              <img src="${memo.imageUrl}" />
            </div>
          ` : ''}

          ${memo.content ? `
            <section class="section">
              <div class="section-header">
                <span class="section-num">01</span>
                <span class="section-title">AI 核心总结</span>
                <div class="section-line"></div>
              </div>
              <div class="summary-box">
                <div class="summary-text">${memo.content}</div>
              </div>
            </section>
          ` : ''}

          ${memo.blocks ? `
            <section class="section">
              <div class="section-header">
                <span class="section-num">02</span>
                <span class="section-title">结构化深度分析</span>
                <div class="section-line"></div>
              </div>
              <div class="blocks-container">
                ${memo.blocks.map((block, idx) => {
                  const icon = block.type === 'todo' ? '✅' : 
                               block.type === 'highlight' ? '💡' :
                               block.type === 'quote' ? '💬' :
                               block.type === 'step' ? '🔢' :
                               block.type === 'bento' ? '🍱' : '📄';
                  return `
                    <div class="block-card">
                      <div class="block-head">
                        <div class="block-icon">${icon}</div>
                        <div class="block-title">${block.title || block.type.toUpperCase()}</div>
                      </div>
                      <div class="block-body">
                        ${Array.isArray(block.content) ? `
                          <ul>${block.content.map(line => `<li>${line}</li>`).join('')}</ul>
                        ` : `<p>${block.content}</p>`}
                        
                        ${block.todoItems ? `
                          <div class="todo-box">
                            ${block.todoItems.map(item => `
                              <div class="todo-row">
                                <div class="todo-check">${item.completed ? '✓' : ''}</div>
                                <div class="todo-content">
                                  <div class="todo-task">${item.task}</div>
                                  ${item.time || item.notes ? `
                                    <div class="todo-meta">
                                      ${item.time ? `<span>⏰ ${item.time}</span>` : ''}
                                      ${item.notes ? `<span>📝 ${item.notes}</span>` : ''}
                                    </div>
                                  ` : ''}
                                </div>
                              </div>
                            `).join('')}
                          </div>
                        ` : ''}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </section>
          ` : ''}

          ${memo.rawText ? `
            <section class="raw-section">
              <span class="raw-header">--- 原始记录存档 ---</span>
              <div class="raw-wrapper">${memo.rawText}</div>
            </section>
          ` : ''}

          <footer class="footer">
            <span>Smart Memo AI Assistant</span>
            <span>Page 1 of 1</span>
          </footer>
        </div>

        <script>
          window.onload = () => {
            window.print();
            setTimeout(() => {
              window.frameElement.remove();
            }, 1000);
          };
        </script>
      </body>
      </html>
    `;

    doc.open();
    doc.write(html);
    doc.close();
  };

  const handleShare = async (memo: Memo) => {
    setIsShareSheetOpen(true);
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
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 print-content" ref={printRef}>
              <div className="flex items-center gap-2 mb-4 no-print">
                <span className="px-2 py-0.5 bg-[#007AFF]/10 text-[#007AFF] text-[10px] font-bold rounded uppercase tracking-wider">{selectedMemo.type}</span>
                <span className="text-xs text-gray-400">{new Date(selectedMemo.timestamp).toLocaleString()}</span>
              </div>
              
              {/* Print-only header */}
              <div className="hidden print:block print-only-header mb-8 border-b border-gray-200 pb-4">
                <div className="text-[10pt] text-gray-500 mb-1">{selectedMemo.type}</div>
                <div className="text-[10pt] text-gray-500">{new Date(selectedMemo.timestamp).toLocaleString()}</div>
              </div>

              <h2 className="text-3xl font-bold mb-6">{selectedMemo.title}</h2>
              
              {selectedMemo.blocks && selectedMemo.content && (
                <div className="mb-8 p-6 bg-[#007AFF]/5 rounded-3xl border border-[#007AFF]/10">
                  <h4 className="text-[10px] font-bold text-[#007AFF] uppercase tracking-widest mb-3 opacity-60">AI 核心解读</h4>
                  <p className="text-lg font-medium text-gray-800 leading-relaxed">{selectedMemo.content}</p>
                </div>
              )}

              {selectedMemo.rawText && selectedMemo.type === '好文收藏' && (
                <div className="mb-8 p-4 bg-black/5 rounded-2xl border border-black/5">
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">原文内容</h4>
                  <p className="text-sm text-gray-600 line-clamp-[10] overflow-y-auto max-h-48">{selectedMemo.rawText}</p>
                </div>
              )}

              {selectedMemo.blocks ? (
                <StructuredRenderer 
                  blocks={selectedMemo.blocks} 
                  onToggleTodo={(bIdx, iIdx) => handleToggleTodo(selectedMemo.id, bIdx, iIdx)} 
                />
              ) : (
                <div className="prose prose-slate max-w-none"><ReactMarkdown>{selectedMemo.content}</ReactMarkdown></div>
              )}
              
              {selectedMemo.imageUrl && (
                <img 
                  src={selectedMemo.imageUrl} 
                  alt="Memo" 
                  className="w-full rounded-2xl mb-6 shadow-sm" 
                  crossOrigin="anonymous"
                />
              )}
              
              {selectedMemo.audioUrl && (
                <div className="mb-6 no-print">
                  <audio controls src={selectedMemo.audioUrl} className="w-full" />
                </div>
              )}

              {selectedMemo.rawText && selectedMemo.type !== '好文收藏' && (
                <div className="mt-12 pt-6 border-t border-black/5 no-print">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">原始输入</h4>
                  <p className="text-sm text-gray-500 italic">{selectedMemo.rawText}</p>
                </div>
              )}
            </div>
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
                  onClick={() => handlePrintToPDF(selectedMemo)}
                  className="w-full bg-white py-4 rounded-2xl font-semibold text-[#007AFF] shadow-sm active:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                >
                  <Share className="w-5 h-5" />
                  打印 / 另存为 PDF
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
        {isChatOpen && <ChatDialog memos={memos} onClose={() => setIsChatOpen(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {isCreating && <MemoCreator onClose={() => setIsCreating(false)} onSave={handleSaveMemo} />}
      </AnimatePresence>
    </div>
  );
}
