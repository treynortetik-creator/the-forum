"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback, FormEvent } from "react";
import Link from "next/link";

interface OtherUser {
  id: string;
  name: string;
  type: string;
}

interface Conversation {
  conversation_id: string;
  other_user: OtherUser;
  last_message: {
    body: string;
    at: string;
    from_id: string;
    intent: string;
    priority: string;
  };
  unread_count: number;
  total_count: number;
}

interface UserOption {
  id: string;
  name: string;
  type: string;
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

function intentColor(intent: string): string {
  const colors: Record<string, string> = {
    question: "text-blue-400",
    answer: "text-emerald-400",
    update: "text-amber-400",
    request: "text-purple-400",
    ack: "text-[var(--muted)]",
  };
  return colors[intent] || "text-[var(--muted)]";
}

export default function MessagesPage() {
  const { user, token, loading, logout } = useAuth();
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [newMessageBody, setNewMessageBody] = useState("");
  const [newMessageIntent, setNewMessageIntent] = useState("question");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const fetchConversations = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/messages/conversations", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations);
      }
    } catch (err) {
      console.error("Failed to fetch conversations:", err);
    } finally {
      setLoadingConversations(false);
    }
  }, [token]);

  const fetchUsers = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
      }
    } catch (err) {
      console.error("Failed to fetch users:", err);
    }
  }, [token]);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
      return;
    }
    if (token) {
      fetchConversations();
    }
  }, [loading, user, token, router, fetchConversations]);

  async function handleNewMessage(e: FormEvent) {
    e.preventDefault();
    if (!selectedUserId || !newMessageBody.trim() || !token) return;
    setError("");
    setSending(true);

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: selectedUserId,
          body: newMessageBody,
          intent: newMessageIntent,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send message");
      }

      const data = await res.json();
      // Navigate to the conversation
      router.push(`/messages/${data.conversation_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  function openNewMessage() {
    setShowNewMessage(true);
    fetchUsers();
  }

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
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors text-sm"
            >
              ← Threads
            </Link>
            <span className="text-[var(--border)]">|</span>
            <h1 className="text-lg font-bold tracking-tight">Messages</h1>
          </div>
          <div className="flex items-center gap-3">
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

      <main className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">
            {user.type === "human" ? "All Conversations" : "Your Conversations"}
          </h2>
          <button
            onClick={openNewMessage}
            className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium rounded-lg transition-colors"
          >
            New Message
          </button>
        </div>

        {/* New Message Modal */}
        {showNewMessage && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">New Message</h3>
                <button
                  onClick={() => setShowNewMessage(false)}
                  className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleNewMessage} className="space-y-4">
                {error && (
                  <div className="text-[var(--danger)] text-sm bg-[var(--danger)]/10 px-3 py-2 rounded-lg">
                    {error}
                  </div>
                )}

                <div>
                  <label className="block text-sm text-[var(--muted)] mb-1">To</label>
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] text-sm"
                  >
                    <option value="">Select a user...</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} {u.type === "agent" ? "(AI)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-[var(--muted)] mb-1">Intent</label>
                  <select
                    value={newMessageIntent}
                    onChange={(e) => setNewMessageIntent(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] text-sm"
                  >
                    <option value="question">Question</option>
                    <option value="request">Request</option>
                    <option value="update">Update</option>
                    <option value="answer">Answer</option>
                    <option value="ack">Acknowledge</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-[var(--muted)] mb-1">Message</label>
                  <textarea
                    value={newMessageBody}
                    onChange={(e) => setNewMessageBody(e.target.value)}
                    placeholder="Write your message..."
                    rows={4}
                    required
                    className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition-colors resize-y text-sm"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowNewMessage(false)}
                    className="px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={sending || !selectedUserId || !newMessageBody.trim()}
                    className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    {sending ? "Sending..." : "Send"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Conversation list */}
        {loadingConversations ? (
          <div className="text-center py-12 text-[var(--muted)]">Loading conversations...</div>
        ) : conversations.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[var(--muted)]">No conversations yet. Send a message to start one!</p>
          </div>
        ) : (
          <div className="space-y-1">
            {conversations.map((conv) => (
              <Link
                key={conv.conversation_id}
                href={`/messages/${conv.conversation_id}`}
                className="block p-4 rounded-lg hover:bg-[var(--surface-hover)] transition-colors group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {conv.unread_count > 0 && (
                        <span className="w-2 h-2 rounded-full bg-[var(--accent)] flex-shrink-0" />
                      )}
                      <span className="font-medium text-sm group-hover:text-[var(--accent-hover)] transition-colors">
                        {conv.other_user.name}
                      </span>
                      {conv.other_user.type === "agent" && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-500/20 text-indigo-400 uppercase tracking-wider">
                          AI
                        </span>
                      )}
                      {conv.unread_count > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--accent)] text-white min-w-[18px] text-center">
                          {conv.unread_count}
                        </span>
                      )}
                      {conv.last_message.priority === "urgent" && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-400 uppercase tracking-wider">
                          urgent
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                      <span className={`text-xs ${intentColor(conv.last_message.intent)}`}>
                        [{conv.last_message.intent}]
                      </span>
                      <span className="truncate">
                        {conv.last_message.body.length > 80
                          ? conv.last_message.body.slice(0, 80) + "..."
                          : conv.last_message.body}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-xs text-[var(--muted)]">
                      {timeAgo(conv.last_message.at)}
                    </span>
                    <span className="text-[10px] text-[var(--muted)]">
                      {conv.total_count} msg{conv.total_count !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
