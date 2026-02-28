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
type MemoType = '灵感记录' | '会议纪要' | '日常随笔' | '任务清单' | '英语拾贝';
const MEMO_TYPES: MemoType[] = ['灵感记录', '会议纪要', '日常随笔', '任务清单', '英语拾贝'];

type BlockType = 'text' | 'list' | 'highlight' | 'step' | 'bento';

interface ContentBlock {
  type: BlockType;
  title?: string;
  content: string | string[];
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
) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("API_KEY_MISSING");
  }
  
  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-3-flash-preview";
  
  let systemInstruction = `你是一位顶级的视觉化笔记专家。你的任务是将用户的输入整理成极其结构化、视觉化的笔记。
  你必须根据内容逻辑，将笔记拆分为不同的“块(blocks)”。
  
  可用块类型：
  1. "highlight": 用于核心金句、最重要的结论或定义。
  2. "step": 用于有先后顺序的步骤、逻辑推导或时间线。
  3. "bento": 用于并列的多个要点、分类说明，适合网格展示。
  4. "text": 用于普通的段落描述。
  5. "list": 用于普通的清单。

  颜色分配建议：
  - 蓝色(blue): 逻辑、冷静、技术
  - 绿色(emerald): 成功、积极、自然
  - 黄色(amber): 警告、重点、灵感
  - 紫色(violet): 创意、深度、总结
  
  请务必使用中文回复，并严格遵守 JSON 格式。`;

  // ... (rest of the system instruction logic remains similar but adapted for blocks)
  switch (type) {
    case '灵感记录':
      systemInstruction += `\n重点：使用 highlight 块展示核心灵感，使用 bento 块展示应用场景。`;
      break;
    case '会议纪要':
      systemInstruction += `\n重点：使用 step 块展示会议流程，使用 highlight 块展示决议。`;
      break;
    case '任务清单':
      systemInstruction += `\n重点：使用 step 块拆解任务，使用 bento 块展示 5W1H 要素。`;
      break;
    case '英语拾贝':
      systemInstruction += `\n重点：使用 highlight 块展示核心短语，使用 bento 块展示例句和语境。`;
      break;
  }

  const parts: any[] = [{ text: systemInstruction }];
  if (text) parts.push({ text: `文字内容: ${text}` });
  if (imageB64) parts.push({ inlineData: { mimeType: "image/jpeg", data: imageB64.split(',')[1] || imageB64 } });
  if (audioB64) {
    const mimeMatch = audioB64.match(/^data:(audio\/[a-z0-9]+);base64,/);
    parts.push({ inlineData: { mimeType: mimeMatch ? mimeMatch[1] : "audio/wav", data: audioB64.split(',')[1] || audioB64 } });
  }

  const response = await ai.models.generateContent({
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
                type: { type: Type.STRING, enum: ["highlight", "step", "bento", "text", "list"] },
                title: { type: Type.STRING },
                content: { 
                  type: Type.ARRAY, 
                  items: { type: Type.STRING },
                  description: "如果是 text 或 highlight，数组只包含一个字符串；如果是 list, step 或 bento，数组包含多个项"
                },
                color: { type: Type.STRING, enum: ["blue", "emerald", "amber", "violet", "rose", "slate"] }
              },
              required: ["type", "content"]
            }
          }
        },
        required: ["title", "blocks"]
      }
    }
  });

  return JSON.parse(response.text);
}

// --- Components ---

function StructuredRenderer({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div className="space-y-6">
      {blocks.map((block, idx) => {
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

        switch (block.type) {
          case 'highlight':
            return (
              <motion.div 
                key={idx}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className={cn("p-6 rounded-3xl border shadow-sm", colorClasses)}
              >
                {block.title && <h4 className="text-[10px] font-bold uppercase tracking-widest mb-2 opacity-60">{block.title}</h4>}
                <p className="text-xl font-bold leading-relaxed">{block.content[0]}</p>
              </motion.div>
            );
          case 'step':
            return (
              <div key={idx} className="space-y-4 relative pl-8 py-2">
                <div className="absolute left-[11px] top-4 bottom-4 w-0.5 bg-gray-200" />
                {(block.content as string[]).map((step, sIdx) => (
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
                {(block.content as string[]).map((item, bIdx) => (
                  <div key={bIdx} className={cn("p-4 rounded-2xl border flex flex-col justify-center min-h-[80px]", colorClasses)}>
                    <p className="text-xs font-bold leading-snug">{item}</p>
                  </div>
                ))}
              </div>
            );
          case 'list':
            return (
              <ul key={idx} className="space-y-3">
                {(block.content as string[]).map((item, lIdx) => (
                  <li key={lIdx} className="flex items-start gap-3 text-sm text-gray-600">
                    <span className={cn("mt-1.5 w-1.5 h-1.5 rounded-full shrink-0", dotColor)} />
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            );
          default:
            return <p key={idx} className="text-sm text-gray-600 leading-relaxed">{block.content[0]}</p>;
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
        {memo.blocks ? (
          <p>{memo.blocks.find(b => b.type === 'text' || b.type === 'highlight')?.content[0] || memo.content}</p>
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/ogg';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
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
    try {
      const analysis = await analyzeMemo(type, text, image || undefined, audio || undefined);
      onSave({
        id: Date.now().toString(),
        type,
        title: analysis.title,
        content: analysis.summary || "",
        blocks: analysis.blocks,
        rawText: text,
        imageUrl: image,
        audioUrl: audio,
        timestamp: Date.now(),
      });
      onClose();
    } catch (error: any) {
      if (error.message === 'API_KEY_MISSING') {
        alert('请先在设置中配置 Gemini API Key');
      } else {
        alert('分析失败，请稍后重试');
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
            {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : "AI 整理"}
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
          <button className="flex flex-col items-center gap-1 group opacity-50 cursor-not-allowed">
            <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-sm border border-black/5"><TypeIcon className="w-6 h-6 text-[#007AFF]" /></div>
            <span className="text-[10px] text-gray-500 font-medium">扫描</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// --- Main App ---

export default function App() {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedMemo, setSelectedMemo] = useState<Memo | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_api_key') || '');

  const [isShareSheetOpen, setIsShareSheetOpen] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  // Load from IndexedDB on mount
  useEffect(() => {
    getAllMemos().then(setMemos).catch(console.error);
  }, []);

  const handleShareAsImage = async (memo: Memo) => {
    if (!printRef.current) return;
    setIsShareSheetOpen(false);
    
    try {
      // Wait for images to load
      await new Promise(resolve => setTimeout(resolve, 600));
      
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(printRef.current, {
        scale: 1.5,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });

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
    const originalTitle = document.title;
    const fileName = `[${memo.type}]_${memo.title}_${new Date().toISOString().split('T')[0]}`;
    
    document.title = fileName;
    
    // Small delay to ensure UI is ready
    setTimeout(() => {
      window.print();
      document.title = originalTitle;
    }, 100);
  };

  const handleShare = async (memo: Memo) => {
    setIsShareSheetOpen(true);
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

  const filteredMemos = memos.filter(m => 
    m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
            <div className="flex gap-4">
              <button onClick={() => setIsSettingsOpen(true)} className="p-2 bg-white rounded-full shadow-sm border border-black/5 ios-button">
                <Settings className="w-5 h-5 text-[#007AFF]" />
              </button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text" placeholder="搜索" value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black/5 rounded-xl py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 transition-all"
            />
          </div>
        </header>
        <main className="flex-1 px-4 py-6">
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
        <div className="ios-blur sticky bottom-0 px-6 py-4 flex justify-between items-center no-print">
          <p className="text-xs text-gray-500 font-medium">{memos.length} 条备忘录</p>
          <button onClick={() => setIsCreating(true)} className="w-12 h-12 bg-[#007AFF] text-white rounded-full flex items-center justify-center shadow-lg shadow-[#007AFF]/30 ios-button">
            <Plus className="w-6 h-6" />
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
              
              {selectedMemo.blocks ? (
                <StructuredRenderer blocks={selectedMemo.blocks} />
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

              {selectedMemo.rawText && (
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
        {isCreating && <MemoCreator onClose={() => setIsCreating(false)} onSave={handleSaveMemo} />}
      </AnimatePresence>
    </div>
  );
}
