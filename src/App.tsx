import React, { useState, useEffect, useRef } from 'react';
import { Plus, Search, Settings, ChevronLeft, Trash2, Share, X, Mic, Image as ImageIcon, Type as TypeIcon, Loader2, Clock, Calendar, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { GoogleGenAI, Type } from "@google/genai";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utilities ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
type MemoType = '灵感记录' | '会议纪要' | '日常随笔' | '任务清单' | '英语拾贝';
const MEMO_TYPES: MemoType[] = ['灵感记录', '会议纪要', '日常随笔', '任务清单', '英语拾贝'];

interface Memo {
  id: string;
  type: MemoType;
  title: string;
  content: string;
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
  
  let systemInstruction = `你是一位专业的笔记整理专家。请分析以下输入的 ${type} 内容，并将其整理成专业、结构化的笔记。
  输入可能包含文字、图片或语音录音。
  - 如果有语音录音，请先将其转录并理解其含义。
  - 如果有图片，请结合图片内容进行分析。
  - 请务必使用中文回复（除非是英语学习相关内容），并以 Markdown 格式返回结果，包含一个清晰的标题。`;

  switch (type) {
    case '灵感记录':
      systemInstruction += `\n重点：解释这个灵感的具体内容，分析其独特性，并详细说明这个灵感可以应用在哪些具体的场景或领域。`;
      break;
    case '会议纪要':
      systemInstruction += `\n重点：记录会议的主旨（Theme）、讨论的关键要点（Key Points），并明确列出后续跟进事项（Follow-ups）及责任人。`;
      break;
    case '日常随笔':
      systemInstruction += `\n重点：忠实地反映用户当时的想法和情感，保持原汁原味，仅在排版上进行微调使其易于阅读。`;
      break;
    case '任务清单':
      systemInstruction += `\n重点：按照 5W1H 框架（Who 负责人, What 任务内容, Where 地点, When 时间, Why 目的, How 执行方式）来详细分析和拆解这项任务。`;
      break;
    case '英语拾贝':
      systemInstruction = `你是一位地道的英语老师。用户会输入中文短语或句子。
      你的任务：
      1. 分析该中文表达。
      2. 提供 1-2 个最地道、**使用率极高**的英语表达方式（优先选择在现代口语或书面语中频繁出现的词汇/短语，避免生僻或过时的表达）。
      3. 解释这些英语表达的用法、语境（如：正式 vs 非正式）或细微差别。
      4. 为每个英语表达提供一个**非常实用、生活化**的例句。
      请以 Markdown 格式返回，标题应为该中文短语的翻译。`;
      break;
  }

  const parts: any[] = [{ text: systemInstruction }];

  if (text && text.trim() !== "") {
    parts.push({ text: `文字内容: ${text}` });
  }

  if (imageB64) {
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: imageB64.split(',')[1] || imageB64
      }
    });
  }

  if (audioB64) {
    const mimeMatch = audioB64.match(/^data:(audio\/[a-z0-9]+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : "audio/wav";
    parts.push({
      inlineData: {
        mimeType,
        data: audioB64.split(',')[1] || audioB64
      }
    });
  }

  const response = await ai.models.generateContent({
    model,
    contents: { parts },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "备忘录的简短标题" },
          content: { type: Type.STRING, description: "整理后的 Markdown 内容，使用真实的换行符而非转义字符" }
        },
        required: ["title", "content"]
      }
    }
  });

  let textResponse = response.text || "{}";
  const result = JSON.parse(textResponse);
  if (typeof result.content === 'string') {
    result.content = result.content.replace(/\\n/g, '\n');
  }
  return result as { title: string; content: string };
}

// --- Components ---

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
        <ReactMarkdown>{memo.content}</ReactMarkdown>
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
      reader.onloadend = () => setImage(reader.result as string);
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
    const title = firstLine.length > 0 ? (firstLine.length > 20 ? firstLine.substring(0, 20) + '...' : firstLine) : '新备忘录';
    
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
        content: analysis.content,
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
  const [memos, setMemos] = useState<Memo[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('smart_memos');
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });
  const [isCreating, setIsCreating] = useState(false);
  const [selectedMemo, setSelectedMemo] = useState<Memo | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_api_key') || '');

  useEffect(() => {
    if (memos.length > 0 || localStorage.getItem('smart_memos')) {
      localStorage.setItem('smart_memos', JSON.stringify(memos));
    }
  }, [memos]);

  const handleShare = async (memo: Memo) => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: memo.title,
          text: `${memo.title}\n\n${memo.content}`,
          url: window.location.href
        });
      } catch (error) {
        console.error('Error sharing:', error);
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${memo.title}\n\n${memo.content}`);
        alert('内容已复制到剪贴板，你可以手动粘贴到备忘录。');
      } catch (err) {
        alert('分享失败');
      }
    }
  };

  const handleSaveMemo = (newMemo: Memo) => {
    setMemos([newMemo, ...memos]);
  };

  const handleDeleteMemo = (id: string) => {
    setMemos(memos.filter(m => m.id !== id));
    setSelectedMemo(null);
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
      <div className="flex-1 flex flex-col">
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
        <div className="ios-blur sticky bottom-0 px-6 py-4 flex justify-between items-center">
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
            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="px-2 py-0.5 bg-[#007AFF]/10 text-[#007AFF] text-[10px] font-bold rounded uppercase tracking-wider">{selectedMemo.type}</span>
                <span className="text-xs text-gray-400">{new Date(selectedMemo.timestamp).toLocaleString()}</span>
              </div>
              <h2 className="text-3xl font-bold mb-6">{selectedMemo.title}</h2>
              {selectedMemo.imageUrl && <img src={selectedMemo.imageUrl} alt="Memo" className="w-full rounded-2xl mb-6 shadow-sm" />}
              <div className="prose prose-slate max-w-none"><ReactMarkdown>{selectedMemo.content}</ReactMarkdown></div>
              {selectedMemo.rawText && (
                <div className="mt-12 pt-6 border-t border-black/5">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">原始输入</h4>
                  <p className="text-sm text-gray-500 italic">{selectedMemo.rawText}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCreating && <MemoCreator onClose={() => setIsCreating(false)} onSave={handleSaveMemo} />}
      </AnimatePresence>
    </div>
  );
}
