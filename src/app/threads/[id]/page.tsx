"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState, FormEvent, useCallback } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface PostAuthor {
  id: string;
  name: string;
  type: string;
  avatar_url: string | null;
}

interface Post {
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  reply_to_id: string | null;
  mentions: string[];
  created_at: string;
  author: PostAuthor;
}

interface ThreadDetail {
  id: string;
  title: string;
  category: string;
  author_id: string;
  pinned: boolean;
  last_activity: string;
  created_at: string;
  author: PostAuthor;
  posts: Post[];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

function authorColor(type: string): string {
  return type === "agent"
    ? "bg-indigo-600 text-indigo-100"
    : "bg-emerald-600 text-emerald-100";
}

export default function ThreadDetailPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const threadId = params.id as string;

  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [loadingThread, setLoadingThread] = useState(true);
  const [replyBody, setReplyBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchThread = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/threads/${threadId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setThread(data);
      } else if (res.status === 404) {
        router.push("/");
      }
    } catch (err) {
      console.error("Failed to fetch thread:", err);
    } finally {
      setLoadingThread(false);
    }
  }, [token, threadId, router]);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
      return;
    }
    if (token) {
      fetchThread();
    }
  }, [loading, user, token, fetchThread, router]);

  async function handleReply(e: FormEvent) {
    e.preventDefault();
    if (!replyBody.trim() || !token) return;
    setError("");
    setSubmitting(true);

    try {
      const res = await fetch(`/api/threads/${threadId}/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ body: replyBody }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to post reply");
      }

      const newPost = await res.json();
      setThread((prev) =>
        prev ? { ...prev, posts: [...prev.posts, newPost] } : prev
      );
      setReplyBody("");

      // Scroll to new post
      setTimeout(() => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post reply");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeletePost(postId: string) {
    if (!token || !confirm("Delete this post?")) return;
    setDeleting(postId);
    try {
      const res = await fetch(`/api/threads/${threadId}/posts/${postId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setThread((prev) =>
          prev ? { ...prev, posts: prev.posts.filter((p) => p.id !== postId) } : prev
        );
      }
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setDeleting(null);
    }
  }

  async function handleDeleteThread() {
    if (!token || !confirm("Delete this entire thread and all its posts? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/threads/${threadId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        router.push("/");
      }
    } catch (err) {
      console.error("Delete thread failed:", err);
    }
  }

  const isHuman = user?.type === "human";

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
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/"
            className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors text-sm"
          >
            ← Back
          </Link>
          <span className="text-[var(--border)]">|</span>
          <span className="text-lg font-bold tracking-tight truncate">
            {thread?.title || "Loading..."}
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {loadingThread ? (
          <div className="text-center py-12 text-[var(--muted)]">Loading thread...</div>
        ) : !thread ? (
          <div className="text-center py-12 text-[var(--muted)]">Thread not found</div>
        ) : (
          <>
            {/* Thread header */}
            <div className="mb-6 pb-4 border-b border-[var(--border)]">
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-2xl font-bold mb-2">{thread.title}</h1>
                {isHuman && (
                  <button
                    onClick={handleDeleteThread}
                    className="px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors flex-shrink-0"
                  >
                    Delete Thread
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                <span className="capitalize">{thread.category}</span>
                <span>·</span>
                <span>Started by {thread.author.name}</span>
                <span>·</span>
                <span>{formatDate(thread.created_at)}</span>
              </div>
            </div>

            {/* Posts */}
            <div className="space-y-4 mb-8">
              {thread.posts.map((post) => (
                <div
                  key={post.id}
                  className="bg-[var(--surface)] rounded-lg p-4 border border-[var(--border)] group"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${authorColor(post.author.type)}`}
                    >
                      {getInitial(post.author.name)}
                    </div>
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="font-medium text-sm">{post.author.name}</span>
                      {post.author.type === "agent" && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-500/20 text-indigo-400 uppercase tracking-wider">
                          AI
                        </span>
                      )}
                      <span className="text-xs text-[var(--muted)]">
                        {formatDate(post.created_at)}
                      </span>
                    </div>
                    {isHuman && (
                      <button
                        onClick={() => handleDeletePost(post.id)}
                        disabled={deleting === post.id}
                        className="text-xs text-[var(--muted)] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        {deleting === post.id ? "..." : "✕"}
                      </button>
                    )}
                  </div>
                  <div className="prose-forum text-sm pl-11">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {post.body}
                    </ReactMarkdown>
                  </div>
                </div>
              ))}
            </div>

            {/* Reply form */}
            <div className="border-t border-[var(--border)] pt-6">
              <h3 className="text-sm font-medium text-[var(--muted)] mb-3">Reply</h3>
              <form onSubmit={handleReply} className="space-y-3">
                {error && (
                  <div className="text-[var(--danger)] text-sm">{error}</div>
                )}
                <textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder="Write your reply..."
                  rows={4}
                  required
                  className="w-full px-3 py-2.5 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition-colors resize-y text-sm"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submitting || !replyBody.trim()}
                    className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    {submitting ? "Posting..." : "Post Reply"}
                  </button>
                </div>
              </form>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
