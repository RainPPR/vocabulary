import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Types
interface WordItem {
  value: string;
  usphone?: string;
  ukphone?: string;
  translation?: string;
  definition?: string;
  pos?: string;
  collins?: number;
  oxford?: boolean;
  tag?: string; // space separated tags
  bnc?: number; // British National Corpus frequency rank
  frq?: number; // COCA or other frequency rank
}

interface DictionaryFile {
  name: string;
  type: string;
  language?: string;
  size?: number;
  relateVideoPath?: string;
  subtitlesTrackId?: number;
  wordList: WordItem[];
}

interface ProgressData {
  known: boolean;
  favorite: boolean;
  seenCount: number;
  correctCount: number;
  streak: number;
  lastReviewed: number | null;
  nextDue: number | null;
}

interface WordWithProgress extends WordItem {
  id: string;
  progress: ProgressData;
}

// Sample data for first run
const sampleData: DictionaryFile = {
  name: "Default",
  type: "DOCUMENT",
  language: "",
  size: 5,
  relateVideoPath: "",
  subtitlesTrackId: 0,
  wordList: [],
};

// Utility: localStorage hook
function useLocalStorage<T>(key: string, initialValue: T) {
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch (e) {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, JSON.stringify(state));
      }
    } catch (e) {
      // ignore
    }
  }, [key, state]);

  return [state, setState] as const;
}

// Icons
function SpeakerIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 9v6a1 1 0 0 0 1 1h3l4.5 3V5L7 8H4a1 1 0 0 0-1 1Zm12.5-3.5a6.5 6.5 0 0 1 0 13M15 9a3 3 0 0 1 0 6"
      />
    </svg>
  );
}

function StarIcon({ filled, className }: { filled?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.5}
      className={className}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.48 3.5 9.4 8.07l-5.01.41 3.81 3.28-1.15 4.86 4.43-2.7 4.43 2.7-1.15-4.86 3.81-3.28-5.01-.41-2.08-4.57Z"
      />
    </svg>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
    </svg>
  );
}

function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function MoonIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"
      />
    </svg>
  );
}

function SunIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93 6.34 6.34M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07 6.34 17.66M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

// Helpers
const defaultProgress: ProgressData = {
  known: false,
  favorite: false,
  seenCount: 0,
  correctCount: 0,
  streak: 0,
  lastReviewed: null,
  nextDue: null,
};

function normalizeDictionary(file: DictionaryFile): WordWithProgress[] {
  const list = file.wordList || [];
  return list.map((w, idx) => ({
    ...w,
    id: `${w.value}-${idx}`,
    progress: { ...defaultProgress },
  }));
}

function getProgressKey(dictName: string) {
  return `word-progress-${dictName || "default"}`;
}

function now() {
  return Date.now();
}

// Spaced repetition intervals (ms)
const INTERVALS = {
  again: 10 * 1000, // 10s
  good: 10 * 60 * 1000, // 10m
  easy: 60 * 60 * 1000, // 1h
};

// Youdao audio
async function playYoudaoAudio(word: string, variant: "us" | "uk") {
  const base = "https://dict.youdao.com/dictvoice";
  // Try types: empirical best-effort. Docs: 1 UK, 2 US. We'll fallback to 0.
  const queue = variant === "us" ? [2, 0, 1] : [1, 0, 2];

  for (const t of queue) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await playOnce(`${base}?audio=${encodeURIComponent(word)}&type=${t}`);
      return;
    } catch (e) {
      // try next
    }
  }
  // As a last attempt, no type
  try {
    await playOnce(`${base}?audio=${encodeURIComponent(word)}`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("音频播放失败:", e);
  }
}

function playOnce(url: string) {
  return new Promise<void>((resolve, reject) => {
    const audio = new Audio(url);
    const onPlay = () => {
      cleanup();
      resolve();
    };
    const onError = (e: Event) => {
      cleanup();
      reject(e);
    };
    function cleanup() {
      audio.removeEventListener("playing", onPlay);
      audio.removeEventListener("error", onError);
    }
    audio.addEventListener("playing", onPlay);
    audio.addEventListener("error", onError);
    audio.play().catch(reject);
  });
}

// Main Component
const Page: React.FC = () => {
  // Theme
  const [dark, setDark] = useLocalStorage<boolean>("theme-dark", false);
  useEffect(() => {
    // Apply dark class to html for consistency
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      if (dark) root.classList.add("dark");
      else root.classList.remove("dark");
    }
  }, [dark]);

  // Dictionary and progress
  const [dict, setDict] = useState<DictionaryFile | null>(null);
  const [words, setWords] = useState<WordWithProgress[]>([]);
  const [progressStore, setProgressStore] = useLocalStorage<Record<string, ProgressData>>(getProgressKey("Default"), {});

  // Initialize with sample
  useEffect(() => {
    if (!dict) {
      setDict(sampleData);
      const normalized = normalizeDictionary(sampleData);
      setWords(normalized);
    }
  }, [dict]);

  // Load stored progress when dict changes
  useEffect(() => {
    const name = dict?.name || "Default";
    const key = getProgressKey(name);
    try {
      const raw = localStorage.getItem(key);
      const obj = raw ? (JSON.parse(raw) as Record<string, ProgressData>) : {};
      setProgressStore(obj);
    } catch (e) {
      setProgressStore({});
    }
  }, [dict?.name]);

  // Merge progress into words
  useEffect(() => {
    setWords((prev) => {
      return prev.map((w) => ({ ...w, progress: { ...defaultProgress, ...(progressStore[w.value] || {}) } }));
    });
  }, [progressStore]);

  // Save progress helper
  const updateProgress = useCallback(
    (wordValue: string, updater: (p: ProgressData) => ProgressData) => {
      setProgressStore((prev) => {
        const next = { ...prev };
        const current = prev[wordValue] || { ...defaultProgress };
        next[wordValue] = updater(current);
        const name = dict?.name || "Default";
        const key = getProgressKey(name);
        localStorage.setItem(key, JSON.stringify(next));
        return next;
      });
    },
    [dict?.name, setProgressStore]
  );

  // File import
  const onFileChange = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text) as DictionaryFile;
      if (!json.wordList || !Array.isArray(json.wordList)) throw new Error("JSON 结构不正确");
      setDict(json);
      const normalized = normalizeDictionary(json);
      setWords(normalized);
      // Reset store load for new dict
      const key = getProgressKey(json.name || "default");
      const raw = localStorage.getItem(key);
      const obj = raw ? (JSON.parse(raw) as Record<string, ProgressData>) : {};
      setProgressStore(obj);
    } catch (e) {
      alert("导入失败：请确认 JSON 结构正确。");
    }
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Drag & drop
  const [dragOver, setDragOver] = useState(false);
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    onFileChange(file);
  };

  // Study states
  type ViewMode = "list" | "flash" | "quiz";
  const [mode, setMode] = useState<ViewMode>("list");

  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [onlyDue, setOnlyDue] = useState(false);
  const [sortBy, setSortBy] = useState<string>("alpha"); // alpha|bnc|frq|collins|progress

  const tags = useMemo(() => {
    const set = new Set<string>();
    words.forEach((w) => (w.tag || "").split(/\s+/).filter(Boolean).forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [words]);

  const filteredWords = useMemo(() => {
    const q = search.trim().toLowerCase();
    const nowTs = now();
    let list = words.filter((w) => {
      const matchQuery = !q || w.value.toLowerCase().includes(q) || (w.translation || "").toLowerCase().includes(q);
      const matchTag = tagFilter === "all" || (w.tag || "").split(/\s+/).includes(tagFilter);
      const matchFav = !onlyFavorites || w.progress.favorite;
      const matchDue = !onlyDue || (w.progress.nextDue ? w.progress.nextDue <= nowTs : true);
      return matchQuery && matchTag && matchFav && matchDue;
    });

    list = list.sort((a, b) => {
      switch (sortBy) {
        case "bnc":
          return (a.bnc || Infinity) - (b.bnc || Infinity);
        case "frq":
          return (a.frq || Infinity) - (b.frq || Infinity);
        case "collins":
          return (b.collins || 0) - (a.collins || 0);
        case "progress":
          return (b.progress.streak || 0) - (a.progress.streak || 0);
        case "alpha":
        default:
          return a.value.localeCompare(b.value);
      }
    });

    return list;
  }, [words, search, tagFilter, onlyFavorites, onlyDue, sortBy]);

  // Stats
  const stats = useMemo(() => {
    const total = words.length;
    let known = 0;
    let studied = 0;
    let due = 0;
    const nowTs = now();
    words.forEach((w) => {
      if (w.progress.known) known += 1;
      if (w.progress.seenCount > 0) studied += 1;
      if (!w.progress.nextDue || w.progress.nextDue <= nowTs) due += 1;
    });
    const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
    return { total, known, studied, due, pctKnown: pct(known), pctStudied: pct(studied) };
  }, [words]);

  // Flashcards
  const [flashIndex, setFlashIndex] = useState(0);
  const [flashRevealed, setFlashRevealed] = useState(false);

  const flashList = useMemo(() => {
    const list = filteredWords;
    return list;
  }, [filteredWords]);

  useEffect(() => {
    setFlashIndex(0);
    setFlashRevealed(false);
  }, [flashList.length, mode]);

  const currentFlash = flashList[flashIndex];

  const gradeFlash = (grade: "again" | "good" | "easy") => {
    if (!currentFlash) return;
    const interval = INTERVALS[grade];
    updateProgress(currentFlash.value, (p) => ({
      ...p,
      seenCount: p.seenCount + 1,
      correctCount: grade === "again" ? p.correctCount : p.correctCount + 1,
      streak: grade === "again" ? 0 : p.streak + 1,
      lastReviewed: now(),
      nextDue: now() + interval,
    }));
    setFlashRevealed(false);
    setFlashIndex((i) => (i + 1) % Math.max(1, flashList.length));
  };

  // Keyboard shortcuts for flash
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (mode !== "flash") return;
      if (e.key === " ") {
        e.preventDefault();
        setFlashRevealed((r) => !r);
      } else if (e.key.toLowerCase() === "a") gradeFlash("again");
      else if (e.key.toLowerCase() === "g") gradeFlash("good");
      else if (e.key.toLowerCase() === "e") gradeFlash("easy");
      else if (e.key === "ArrowRight") setFlashIndex((i) => (i + 1) % Math.max(1, flashList.length));
      else if (e.key === "ArrowLeft") setFlashIndex((i) => (i - 1 + Math.max(1, flashList.length)) % Math.max(1, flashList.length));
      else if (e.key.toLowerCase() === "p") currentFlash && playYoudaoAudio(currentFlash.value, "us");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, flashList.length, currentFlash]);

  // Quiz
  type QuizMode = "w2t" | "t2w"; // word to translation / translation to word
  const [quizMode, setQuizMode] = useState<QuizMode>("w2t");
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswered, setQuizAnswered] = useState<number | null>(null);
  const [quizOptions, setQuizOptions] = useState<WordWithProgress[]>([]);

  const generateQuiz = useCallback(() => {
    const base = filteredWords.length ? filteredWords : words;
    if (base.length === 0) return;
    const correctIdx = Math.floor(Math.random() * base.length);
    const correct = base[correctIdx];
    const pool = base.filter((_, i) => i !== correctIdx);
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
    const opts = [...shuffled, correct].sort(() => Math.random() - 0.5);
    setQuizIndex(correctIdx);
    setQuizOptions(opts);
    setQuizAnswered(null);
  }, [filteredWords, words]);

  useEffect(() => {
    if (mode === "quiz") generateQuiz();
  }, [mode, generateQuiz]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (mode !== "quiz") return;
      const map: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3 };
      if (e.key in map) {
        e.preventDefault();
        onChoose(map[e.key]);
      } else if (e.key.toLowerCase() === "p") {
        const correct = filteredWords[quizIndex];
        if (correct) playYoudaoAudio(correct.value, "us");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, filteredWords, quizIndex]);

  const onChoose = (idx: number) => {
    if (!quizOptions.length) return;
    if (quizAnswered !== null) return;
    setQuizAnswered(idx);
    const correct = filteredWords[quizIndex];
    const chosen = quizOptions[idx];
    if (correct && chosen) {
      const isCorrect = chosen.value === correct.value;
      updateProgress(correct.value, (p) => ({
        ...p,
        seenCount: p.seenCount + 1,
        correctCount: p.correctCount + (isCorrect ? 1 : 0),
        streak: isCorrect ? p.streak + 1 : 0,
        lastReviewed: now(),
        nextDue: now() + (isCorrect ? INTERVALS.good : INTERVALS.again),
      }));
    }
  };

  const nextQuiz = () => {
    generateQuiz();
  };

  // Export progress
  const exportProgress = () => {
    const name = dict?.name || "default";
    const dataStr = JSON.stringify(progressStore, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-progress.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // UI helpers
  const PrimaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = "", children, ...props }) => (
    <button
      className={`inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );

  const OutlineButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = "", children, ...props }) => (
    <button
      className={`inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-800 ${className}`}
      {...props}
    >
      {children}
    </button>
  );

  const Chip: React.FC<{ active?: boolean; onClick?: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium border ${
        active
          ? "bg-indigo-600 text-white border-indigo-600"
          : "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700"
      }`}
    >
      {children}
    </button>
  );

  const Divider = () => <hr className="my-6 border-slate-200 dark:border-slate-700" />;

  return (
    <div className={dark ? "dark" : ""}>
      <div
        className="min-h-screen bg-slate-50 text-slate-900 transition-colors duration-300 dark:bg-slate-900 dark:text-slate-100"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {/* Header */}
        <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
          <div className="mx-auto max-w-6xl px-4 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-indigo-600 px-3 py-2 text-white shadow">
                  <span className="text-base font-bold">V</span>
                </div>
                <div>
                  <h1 className="text-lg font-semibold">词汇学习</h1>
                  <p className="text-xs text-slate-500 dark:text-slate-400">导入 JSON 词典，开启高效记忆</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <OutlineButton onClick={() => setDark((v) => !v)} aria-label="切换主题">
                  {dark ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
                </OutlineButton>
                <OutlineButton onClick={exportProgress}>导出进度</OutlineButton>
                <PrimaryButton onClick={() => fileInputRef.current?.click()}>导入 JSON</PrimaryButton>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => onFileChange(e.target.files?.[0])}
                />
              </div>
            </div>
          </div>
        </header>

        {/* Hero / drag overlay */}
        <section className="bg-gradient-to-r from-indigo-600 to-emerald-500 text-white">
          <div className="mx-auto max-w-6xl px-4 py-10">
            <h2 className="text-2xl font-bold">{dict?.name || "未命名"}</h2>
            <p className="mt-2 text-sm text-indigo-100">共 {words.length} 个词 · 支持美音/英音发音、背卡与测验</p>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-white/10 p-4 backdrop-blur">
                <p className="text-sm text-indigo-100">学习进度</p>
                <p className="mt-2 text-2xl font-bold">{stats.pctStudied}%</p>
                <div className="mt-3 h-2 w-full rounded-full bg-white/20">
                  <div className="h-2 rounded-full bg-white" style={{ width: `${stats.pctStudied}%` }} />
                </div>
                <p className="mt-2 text-xs text-indigo-100">已学习 {stats.studied}/{stats.total}</p>
              </div>
              <div className="rounded-xl bg-white/10 p-4 backdrop-blur">
                <p className="text-sm text-indigo-100">掌握程度</p>
                <p className="mt-2 text-2xl font-bold">{stats.pctKnown}%</p>
                <div className="mt-3 h-2 w-full rounded-full bg-white/20">
                  <div className="h-2 rounded-full bg-emerald-300" style={{ width: `${stats.pctKnown}%` }} />
                </div>
                <p className="mt-2 text-xs text-indigo-100">已掌握 {stats.known}/{stats.total}</p>
              </div>
              <div className="rounded-xl bg-white/10 p-4 backdrop-blur">
                <p className="text-sm text-indigo-100">待复习</p>
                <p className="mt-2 text-2xl font-bold">{stats.due}</p>
                <p className="mt-2 text-xs text-indigo-100">随时巩固，效果更佳</p>
              </div>
            </div>
          </div>
        </section>

        {/* Controls */}
        <main className="mx-auto max-w-6xl px-4 py-8">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索单词或释义"
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="alpha">字母序</option>
              <option value="bnc">BNC 频次</option>
              <option value="frq">FRQ 频次</option>
              <option value="collins">柯林斯星级</option>
              <option value="progress">熟练度</option>
            </select>

            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="all">全部标签</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={onlyFavorites} onChange={(e) => setOnlyFavorites(e.target.checked)} />
              仅收藏
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} />
              仅到期
            </label>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <Chip active={mode === "list"} onClick={() => setMode("list")}>单词列表</Chip>
            <Chip active={mode === "flash"} onClick={() => setMode("flash")}>背卡模式</Chip>
            <Chip active={mode === "quiz"} onClick={() => setMode("quiz")}>测验模式</Chip>
          </div>

          <Divider />

          {/* List Mode */}
          {mode === "list" && (
            <section>
              {filteredWords.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <div className="bg-gray-200 border-2 border-dashed rounded-xl w-16 h-16" />
                  <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">将 JSON 文件拖拽至此处或点击上方“导入 JSON”按钮</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
                  {filteredWords.map((w) => (
                    <li key={w.id} className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-semibold">{w.value}</h3>
                            {w.oxford && (
                              <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-100">
                                Oxford
                              </span>
                            )}
                            {w.collins ? (
                              <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900 dark:text-indigo-100">
                                Collins {w.collins}
                              </span>
                            ) : null}
                            {(w.tag || "").split(/\s+/).filter(Boolean).slice(0, 3).map((t) => (
                              <span
                                key={t}
                                className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                              >
                                {t}
                              </span>
                            ))}
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                            <button
                              className="phonetic-block inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
                              data-word={w.value}
                              data-type="0"
                              onClick={() => playYoudaoAudio(w.value, "us")}
                            >
                              <SpeakerIcon className="h-4 w-4" />
                              <span>US {w.usphone || "-"}</span>
                            </button>
                            <button
                              className="phonetic-block inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
                              data-word={w.value}
                              data-type="1"
                              onClick={() => playYoudaoAudio(w.value, "uk")}
                            >
                              <SpeakerIcon className="h-4 w-4" />
                              <span>UK {w.ukphone || "-"}</span>
                            </button>
                            {typeof w.bnc === "number" && (
                              <span className="text-xs text-slate-500">BNC #{w.bnc}</span>
                            )}
                            {typeof w.frq === "number" && (
                              <span className="text-xs text-slate-500">FRQ #{w.frq}</span>
                            )}
                          </div>

                          <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">{w.translation || w.definition || "暂无释义"}</p>
                        </div>

                        <div className="flex w-full max-w-xs flex-col items-end gap-2 sm:w-auto">
                          <div className="flex items-center gap-2">
                            <button
                              className={`rounded-lg border px-3 py-2 text-sm ${
                                w.progress.known
                                  ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-500"
                                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                              }`}
                              onClick={() =>
                                updateProgress(w.value, (p) => ({ ...p, known: !p.known }))
                              }
                            >
                              {w.progress.known ? "已掌握" : "标为掌握"}
                            </button>
                            <button
                              aria-label="收藏"
                              className={`rounded-lg border p-2 ${
                                w.progress.favorite
                                  ? "border-yellow-500 text-yellow-600 dark:border-yellow-400 dark:text-yellow-300"
                                  : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                              }`}
                              onClick={() =>
                                updateProgress(w.value, (p) => ({ ...p, favorite: !p.favorite }))
                              }
                            >
                              <StarIcon className="h-5 w-5" filled={w.progress.favorite} />
                            </button>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>复习 {w.progress.seenCount}</span>
                            <span>正确 {w.progress.correctCount}</span>
                            <span>连对 {w.progress.streak}</span>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Flashcards Mode */}
          {mode === "flash" && (
            <section>
              {!currentFlash ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-sm text-slate-600 dark:text-slate-300">没有可学习的词，请调整筛选条件或导入词典。</p>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">{flashIndex + 1}/{flashList.length}</span>
                      <div className="flex items-center gap-2">
                        <button
                          className="inline-flex items-center gap-1 rounded border border-slate-200 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
                          onClick={() => playYoudaoAudio(currentFlash.value, "us")}
                        >
                          <SpeakerIcon className="h-4 w-4" /> 美音
                        </button>
                        <button
                          className="inline-flex items-center gap-1 rounded border border-slate-200 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
                          onClick={() => playYoudaoAudio(currentFlash.value, "uk")}
                        >
                          <SpeakerIcon className="h-4 w-4" /> 英音
                        </button>
                      </div>
                    </div>

                    <h3 className="mt-6 text-3xl font-bold sm:text-4xl">{currentFlash.value}</h3>
                    <div className="mt-2 flex items-center justify-center gap-4 text-slate-600 dark:text-slate-300">
                      <span className="text-sm">US {currentFlash.usphone || "-"}</span>
                      <span className="text-sm">UK {currentFlash.ukphone || "-"}</span>
                    </div>

                    <div className="mt-8">
                      {!flashRevealed ? (
                        <button
                          className="rounded-lg border border-indigo-300 bg-indigo-50 px-6 py-3 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-900 dark:text-indigo-100"
                          onClick={() => setFlashRevealed(true)}
                        >
                          点击或按空格键显示释义
                        </button>
                      ) : (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-left text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                          <p className="text-lg">{currentFlash.translation || currentFlash.definition || "暂无释义"}</p>
                          <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
                            {(currentFlash.tag || "").split(/\s+/).filter(Boolean).map((t) => (
                              <span key={t} className="rounded bg-slate-200 px-2 py-0.5 dark:bg-slate-700">
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <button
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 text-white shadow hover:bg-red-500"
                        onClick={() => gradeFlash("again")}
                      >
                        <XIcon className="h-5 w-5" /> Again
                      </button>
                      <button
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-white shadow hover:bg-indigo-500"
                        onClick={() => gradeFlash("good")}
                      >
                        <CheckIcon className="h-5 w-5" /> Good
                      </button>
                      <button
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-white shadow hover:bg-emerald-500"
                        onClick={() => gradeFlash("easy")}
                      >
                        <CheckIcon className="h-5 w-5" /> Easy
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Quiz Mode */}
          {mode === "quiz" && (
            <section>
              {filteredWords.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-sm text-slate-600 dark:text-slate-300">没有可测验的词，请调整筛选条件或导入词典。</p>
                </div>
              ) : (
                <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Chip active={quizMode === "w2t"} onClick={() => setQuizMode("w2t")}>英→中</Chip>
                      <Chip active={quizMode === "t2w"} onClick={() => setQuizMode("t2w")}>中→英</Chip>
                    </div>
                    <OutlineButton onClick={generateQuiz}>换一题</OutlineButton>
                  </div>

                  <Divider />

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">题目基于当前筛选</span>
                    <button
                      className="inline-flex items-center gap-1 rounded border border-slate-200 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
                      onClick={() => filteredWords[quizIndex] && playYoudaoAudio(filteredWords[quizIndex].value, "us")}
                    >
                      <SpeakerIcon className="h-4 w-4" /> 发音
                    </button>
                  </div>

                  <div className="mt-6 rounded-xl bg-slate-50 p-6 dark:bg-slate-900">
                    {filteredWords[quizIndex] ? (
                      quizMode === "w2t" ? (
                        <>
                          <h3 className="text-2xl font-bold">{filteredWords[quizIndex].value}</h3>
                          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">选择正确释义</p>
                        </>
                      ) : (
                        <>
                          <h3 className="text-2xl font-bold">{filteredWords[quizIndex].translation || filteredWords[quizIndex].definition || "释义缺失"}</h3>
                          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">选择正确单词</p>
                        </>
                      )
                    ) : (
                      <p>无题目</p>
                    )}
                  </div>

                  <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {quizOptions.map((opt, idx) => {
                      const correct = filteredWords[quizIndex];
                      const isCorrect = correct && opt.value === correct.value;
                      const chosen = quizAnswered === idx;
                      const state = quizAnswered !== null ? (isCorrect ? "correct" : chosen ? "wrong" : "idle") : "idle";
                      const base = "rounded-xl border px-4 py-3 text-left text-sm";
                      const cls =
                        state === "correct"
                          ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-900 dark:text-emerald-100"
                          : state === "wrong"
                          ? "border-red-600 bg-red-50 text-red-700 dark:border-red-500 dark:bg-red-900 dark:text-red-100"
                          : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700";
                      return (
                        <button key={opt.id} className={`${base} ${cls}`} onClick={() => onChoose(idx)}>
                          <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-xs dark:border-slate-600">
                            {idx + 1}
                          </span>
                          {quizMode === "w2t" ? opt.translation || opt.definition || "-" : opt.value}
                        </button>
                      );
                    })}
                  </div>

                  {quizAnswered !== null && (
                    <div className="mt-6 flex items-center justify-between">
                      <div>
                        {quizOptions[quizAnswered] && filteredWords[quizIndex] && quizOptions[quizAnswered].value === filteredWords[quizIndex].value ? (
                          <span className="text-emerald-600">回答正确！</span>
                        ) : (
                          <span className="text-red-600">回答错误，再接再厉。</span>
                        )}
                      </div>
                      <PrimaryButton onClick={nextQuiz}>下一题</PrimaryButton>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </main>

        {/* Drag overlay */}
        {dragOver && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-8 text-center">
            <div className="w-full max-w-xl rounded-2xl border-2 border-dashed border-white/60 p-8 text-white">
              <div className="flex justify-center">
                <div className="bg-gray-200 border-2 border-dashed rounded-xl w-16 h-16" />
              </div>
              <p className="mt-4 text-lg font-semibold">释放鼠标以导入词典 JSON</p>
              <p className="mt-2 text-sm text-slate-200">我们不会上传任何数据，解析在本地浏览器完成。</p>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-12 border-t border-slate-200 py-8 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <div className="mx-auto max-w-6xl px-4">
            <p>
              发音由 <a className="underline" href="https://dict.youdao.com/" target="_blank" rel="noreferrer">有道词典</a> 提供 · 本地存储进度，不会泄露您的隐私
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default Page;