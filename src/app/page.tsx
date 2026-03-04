"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";

interface ThreadAuthor {
  id: string;
  name: string;
  type: string;
  avatar_url: string | null;
}

interface Thread {
  id: string;
  title: string;
  category: string;
  author_id: string;
  pinned: boolean;
  last_activity: string;
  created_at: string;
  author: ThreadAuthor;
  post_count: number;
  has_unread: boolean;
}

interface SearchResult {
  thread: {
    id: string;
    title: string;
    category: string;
    pinned: boolean;
    last_activity: string;
  };
  matching_post: {
    id: string;
    body: string;
    created_at: string;
    author: { id: string; name: string; type: string };
  } | null;
}

const CATEGORIES = ["all", "general", "projects", "philosophy", "chronicle", "random"] as const;
type CategoryFilter = (typeof CATEGORIES)[number];

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function categoryColor(cat: string): string {
  const colors: Record<string, string> = {
    general: "bg-blue-500/20 text-blue-400",
    projects: "bg-emerald-500/20 text-emerald-400",
    philosophy: "bg-purple-500/20 text-purple-400",
    chronicle: "bg-amber-500/20 text-amber-400",
    random: "bg-pink-500/20 text-pink-400",
  };
  return colors[cat] || "bg-gray-500/20 text-gray-400";
}

export default function HomePage() {
  const { user, token, loading, logout } = useAuth();
  const router = useRouter();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [unreadDMs, setUnreadDMs] = useState(0);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchThreads = useCallback(async (category?: string) => {
    if (!token) return;
    try {
      const url = category && category !== "all"
        ? `/api/threads?category=${encodeURIComponent(category)}`
        : "/api/threads";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setThreads(data.threads ?? data);
      }
    } catch (err) {
      console.error("Failed to fetch threads:", err);
    } finally {
      setLoadingThreads(false);
    }
  }, [token]);

  const fetchUnreadDMs = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/messages/unread", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUnreadDMs(data.total);
      }
    } catch {
      // silently fail
    }
  }, [token]);

  const performSearch = useCallback(async (q: string) => {
    if (!token || !q.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `/api/threads/search?q=${encodeURIComponent(q.trim())}&limit=20`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results);
      }
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setSearching(false);
    }
  }, [token]);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
      return;
    }
    if (token) {
      fetchThreads(activeCategory);
      fetchUnreadDMs();
    }
  }, [loading, user, token, router, fetchThreads, fetchUnreadDMs, activeCategory]);

  // Debounced search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    searchTimeout.current = setTimeout(() => {
      performSearch(searchQuery);
    }, 350);
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [searchQuery, performSearch]);

  // Poll unread DM count every 30s
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(fetchUnreadDMs, 30_000);
    return () => clearInterval(interval);
  }, [token, fetchUnreadDMs]);

  function handleCategoryChange(cat: CategoryFilter) {
    setActiveCategory(cat);
    setSearchQuery("");
    setSearchResults(null);
    setLoadingThreads(true);
  }

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--muted)]">Loading...</p>
      </div>
    );
  }

  const showSearch = searchQuery.trim().length > 0;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--border)] sticky top-0 bg-[var(--background)]/95 backdrop-blur-sm z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-bold tracking-tight">The Forum</h1>
          <div className="flex items-center gap-3">
            <Link
              href="/messages"
              className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors relative"
            >
              Messages
              {unreadDMs > 0 && (
                <span className="absolute -top-1.5 -right-3 px-1 py-0.5 rounded-full text-[9px] font-bold bg-[var(--accent)] text-white min-w-[16px] text-center leading-none">
                  {unreadDMs}
                </span>
              )}
            </Link>
            <span className="text-sm text-[var(--muted)]">{user.name}</span>
            <button
              onClick={logout}
              className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* Top bar: title + new thread */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Threads</h2>
          <Link
            href="/threads/new"
            className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium rounded-lg transition-colors"
          >
            New Thread
          </Link>
        </div>

        {/* Search bar */}
        <div className="mb-4">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)] pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search threads and posts..."
              className="w-full pl-9 pr-4 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition-colors text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(""); setSearchResults(null); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Category filter tabs */}
        {!showSearch && (
          <div className="flex gap-1 mb-5 overflow-x-auto">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => handleCategoryChange(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors capitalize ${
                  activeCategory === cat
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Search results */}
        {showSearch ? (
          searching ? (
            <div className="text-center py-12 text-[var(--muted)]">Searching...</div>
          ) : searchResults === null ? null : searchResults.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[var(--muted)]">No results for &ldquo;{searchQuery}&rdquo;</p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-xs text-[var(--muted)] mb-3">{searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for &ldquo;{searchQuery}&rdquo;</p>
              {searchResults.map((result) => (
                <Link
                  key={result.thread.id}
                  href={`/threads/${result.thread.id}`}
                  className="block p-4 rounded-lg hover:bg-[var(--surface-hover)] transition-colors group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {result.thread.pinned && (
                          <span className="text-[var(--accent)] text-xs font-medium">📌</span>
                        )}
                        <h3 className="font-medium truncate group-hover:text-[var(--accent-hover)] transition-colors">
                          {result.thread.title}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${categoryColor(result.thread.category)}`}>
                          {result.thread.category}
                        </span>
                        {result.matching_post && (
                          <span className="truncate text-xs">
                            {result.matching_post.body.length > 80
                              ? result.matching_post.body.slice(0, 80) + "..."
                              : result.matching_post.body}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-[var(--muted)] whitespace-nowrap flex-shrink-0 pt-1">
                      {timeAgo(result.thread.last_activity)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )
        ) : (
          /* Thread list */
          loadingThreads ? (
            <div className="text-center py-12 text-[var(--muted)]">Loading threads...</div>
          ) : threads.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[var(--muted)]">
                {activeCategory === "all"
                  ? "No threads yet. Start a conversation!"
                  : `No threads in ${activeCategory} yet.`}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {threads.map((thread) => (
                <Link
                  key={thread.id}
                  href={`/threads/${thread.id}`}
                  className="block p-4 rounded-lg hover:bg-[var(--surface-hover)] transition-colors group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {thread.pinned && (
                          <span className="text-[var(--accent)] text-xs font-medium">📌</span>
                        )}
                        {thread.has_unread && (
                          <span className="w-2 h-2 rounded-full bg-[var(--accent)] flex-shrink-0" />
                        )}
                        <h3 className="font-medium truncate group-hover:text-[var(--accent-hover)] transition-colors">
                          {thread.title}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${categoryColor(thread.category)}`}>
                          {thread.category}
                        </span>
                        <span>by {thread.author.name}</span>
                        <span>·</span>
                        <span>{thread.post_count} {thread.post_count === 1 ? "post" : "posts"}</span>
                      </div>
                    </div>
                    <span className="text-xs text-[var(--muted)] whitespace-nowrap flex-shrink-0 pt-1">
                      {timeAgo(thread.last_activity)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )
        )}
      </main>
    </div>
  );
}
