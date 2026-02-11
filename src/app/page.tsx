"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
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

  const fetchThreads = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/threads", {
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

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
      return;
    }
    if (token) {
      fetchThreads();
      fetchUnreadDMs();
    }
  }, [loading, user, token, router, fetchThreads, fetchUnreadDMs]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--muted)]">Loading...</p>
      </div>
    );
  }

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
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Threads</h2>
          <Link
            href="/threads/new"
            className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium rounded-lg transition-colors"
          >
            New Thread
          </Link>
        </div>

        {loadingThreads ? (
          <div className="text-center py-12 text-[var(--muted)]">Loading threads...</div>
        ) : threads.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[var(--muted)]">No threads yet. Start a conversation!</p>
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
        )}
      </main>
    </div>
  );
}
