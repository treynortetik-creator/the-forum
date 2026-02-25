"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState, FormEvent, useCallback, useRef } from "react";
import Link from "next/link";

interface MessageUser {
  id: string;
  name: string;
  type: string;
}

interface Message {
  id: string;
  from_id: string;
  to_id: string;
  body: string;
  priority: string;
  read_at: string | null;
  created_at: string;
  conversation_id: string;
  intent: string;
  metadata: Record<string, unknown>;
  from_user: MessageUser;
  to_user: MessageUser;
}

interface AuditEntry {
  id: string;
  event_type: string;
  agent_name: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function intentBadge(intent: string): { bg: string; text: string } {
  const styles: Record<string, { bg: string; text: string }> = {
    question: { bg: "bg-blue-500/20", text: "text-blue-400" },
    answer: { bg: "bg-emerald-500/20", text: "text-emerald-400" },
    update: { bg: "bg-amber-500/20", text: "text-amber-400" },
    request: { bg: "bg-purple-500/20", text: "text-purple-400" },
    ack: { bg: "bg-gray-500/20", text: "text-gray-400" },
  };
  return styles[intent] || styles.ack;
}

function getInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

function authorColor(type: string): string {
  return type === "agent"
    ? "bg-indigo-600 text-indigo-100"
    : "bg-emerald-600 text-emerald-100";
}

function groupMessagesByDate(messages: Message[]): { date: string; messages: Message[] }[] {
  const groups: Record<string, Message[]> = {};
  for (const msg of messages) {
    const dateKey = formatDate(msg.created_at);
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(msg);
  }
  return Object.entries(groups).map(([date, msgs]) => ({
    date,
    messages: msgs,
  }));
}

export default function ConversationPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const conversationId = params.conversationId as string;

  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [replyBody, setReplyBody] = useState("");
  const [replyIntent, setReplyIntent] = useState("answer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMessages = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(
        `/api/messages?conversation_id=${conversationId}&limit=200`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        // API returns DESC, reverse to chronological
        const sorted = [...(data.messages || [])].reverse();
        setMessages(sorted);
      }
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    } finally {
      setLoadingMessages(false);
    }
  }, [token, conversationId]);

  const markMessagesRead = useCallback(async () => {
    if (!token || !user) return;
    const hasUnread = messages.some((m) => m.to_id === user.id && !m.read_at);
    if (!hasUnread) return;
    // Use bulk mark-read endpoint instead of N individual PATCHes
    try {
      await fetch("/api/messages/mark-read", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
    } catch {
      // Silently fail
    }
  }, [token, user, messages, conversationId]);

  const fetchAuditLogs = useCallback(async () => {
    if (!token || user?.type !== "human") return;
    setLoadingAudit(true);
    try {
      const res = await fetch(`/api/audit?limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs);
      }
    } catch (err) {
      console.error("Failed to fetch audit logs:", err);
    } finally {
      setLoadingAudit(false);
    }
  }, [token, user?.type]);

  // Initial load
  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
      return;
    }
    if (token) {
      fetchMessages();
    }
  }, [loading, user, token, fetchMessages, router]);

  // Mark messages read when they load
  useEffect(() => {
    if (messages.length > 0) {
      markMessagesRead();
    }
  }, [messages, markMessagesRead]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length]);

  // Polling every 5 seconds
  useEffect(() => {
    pollRef.current = setInterval(() => {
      fetchMessages();
    }, 5000);

    // Also refetch on window focus
    const handleFocus = () => fetchMessages();
    window.addEventListener("focus", handleFocus);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      window.removeEventListener("focus", handleFocus);
    };
  }, [fetchMessages]);

  async function handleReply(e: FormEvent) {
    e.preventDefault();
    if (!replyBody.trim() || !token) return;
    setError("");
    setWarning("");
    setSubmitting(true);

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: getOtherUserId(),
          body: replyBody,
          intent: replyIntent,
          conversation_id: conversationId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.cooldown_seconds) {
          setWarning(
            `Rate limited: ${data.error} (${data.cooldown_seconds}s remaining)`
          );
        } else if (data.locked) {
          setWarning(`Conversation locked: ${data.error}`);
        } else {
          throw new Error(data.error || "Failed to send message");
        }
        return;
      }

      setReplyBody("");
      fetchMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSubmitting(false);
    }
  }

  function getOtherUserId(): string {
    if (!user || messages.length === 0) return "";
    const first = messages[0];
    return first.from_id === user.id ? first.to_id : first.from_id;
  }

  function getOtherUser(): MessageUser | null {
    if (!user || messages.length === 0) return null;
    const first = messages[0];
    return first.from_id === user.id ? first.to_user : first.from_user;
  }

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--muted)]">Loading...</p>
      </div>
    );
  }

  const otherUser = getOtherUser();
  const dateGroups = groupMessagesByDate(messages);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-[var(--border)] sticky top-0 bg-[var(--background)]/95 backdrop-blur-sm z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/messages"
              className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors text-sm"
            >
              ← Messages
            </Link>
            <span className="text-[var(--border)]">|</span>
            {otherUser ? (
              <div className="flex items-center gap-2">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${authorColor(otherUser.type)}`}
                >
                  {getInitial(otherUser.name)}
                </div>
                <span className="text-lg font-bold tracking-tight">
                  {otherUser.name}
                </span>
                {otherUser.type === "agent" && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-500/20 text-indigo-400 uppercase tracking-wider">
                    AI
                  </span>
                )}
              </div>
            ) : (
              <span className="text-lg font-bold tracking-tight">
                Conversation
              </span>
            )}
          </div>
          {user.type === "human" && (
            <button
              onClick={() => {
                setShowAuditLog(!showAuditLog);
                if (!showAuditLog) fetchAuditLogs();
              }}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                showAuditLog
                  ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              Activity Log
            </button>
          )}
        </div>
      </header>

      {/* Warning banner */}
      {warning && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <span className="text-amber-400 text-sm">{warning}</span>
            <button
              onClick={() => setWarning("")}
              className="text-amber-400/60 hover:text-amber-400 text-sm ml-2"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex max-w-3xl mx-auto w-full">
        {/* Messages */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {loadingMessages ? (
              <div className="text-center py-12 text-[var(--muted)]">
                Loading messages...
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-12 text-[var(--muted)]">
                No messages in this conversation yet.
              </div>
            ) : (
              <div className="space-y-6">
                {dateGroups.map((group) => (
                  <div key={group.date}>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex-1 border-t border-[var(--border)]" />
                      <span className="text-xs text-[var(--muted)] flex-shrink-0">
                        {group.date}
                      </span>
                      <div className="flex-1 border-t border-[var(--border)]" />
                    </div>

                    <div className="space-y-3">
                      {group.messages.map((msg) => {
                        const isMe = msg.from_id === user.id;
                        const sender = msg.from_user;
                        const badge = intentBadge(msg.intent);
                        const warningText = msg.metadata?.warning as string | undefined;
                        const hasWarning = Boolean(warningText);

                        return (
                          <div
                            key={msg.id}
                            className={`flex gap-3 ${isMe ? "flex-row-reverse" : ""}`}
                          >
                            <div
                              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${authorColor(sender.type)}`}
                            >
                              {getInitial(sender.name)}
                            </div>

                            <div
                              className={`max-w-[75%] ${isMe ? "items-end" : "items-start"}`}
                            >
                              <div
                                className={`rounded-lg p-3 ${
                                  isMe
                                    ? "bg-[var(--accent)]/20 border border-[var(--accent)]/30"
                                    : "bg-[var(--surface)] border border-[var(--border)]"
                                }`}
                              >
                                {/* Header */}
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className="text-xs font-medium">
                                    {sender.name}
                                  </span>
                                  {sender.type === "agent" && (
                                    <span className="px-1 py-0.5 rounded text-[9px] font-medium bg-indigo-500/20 text-indigo-400 uppercase tracking-wider">
                                      AI
                                    </span>
                                  )}
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${badge.bg} ${badge.text} uppercase`}
                                  >
                                    {msg.intent}
                                  </span>
                                  {msg.priority === "urgent" && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-red-500/20 text-red-400 uppercase">
                                      urgent
                                    </span>
                                  )}
                                </div>

                                {/* Body */}
                                <div className="text-sm whitespace-pre-wrap">
                                  {msg.body}
                                </div>

                                {/* Warning if loop detected */}
                                {hasWarning && (
                                  <div className="mt-2 text-xs text-amber-400 bg-amber-500/10 px-2 py-1 rounded">
                                    {warningText}
                                  </div>
                                )}
                              </div>

                              {/* Meta */}
                              <div
                                className={`flex items-center gap-2 mt-1 text-[10px] text-[var(--muted)] ${
                                  isMe ? "justify-end" : ""
                                }`}
                              >
                                <span>{formatTime(msg.created_at)}</span>
                                {isMe && (
                                  <span>
                                    {msg.read_at ? "Read" : "Sent"}
                                  </span>
                                )}
                                {user.type === "human" && (
                                  <button
                                    onClick={async () => {
                                      if (!confirm("Delete this message?")) return;
                                      try {
                                        const res = await fetch(`/api/messages/${msg.id}`, {
                                          method: "DELETE",
                                          headers: { Authorization: `Bearer ${token}` },
                                        });
                                        if (res.ok) {
                                          setMessages((prev) => prev.filter((m) => m.id !== msg.id));
                                        }
                                      } catch (err) {
                                        console.error("Delete failed:", err);
                                      }
                                    }}
                                    className="text-[var(--muted)] hover:text-red-400 transition-colors"
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Reply form */}
          <div className="border-t border-[var(--border)] p-4">
            {error && (
              <div className="text-[var(--danger)] text-sm mb-2 bg-[var(--danger)]/10 px-3 py-2 rounded-lg">
                {error}
              </div>
            )}
            <form onSubmit={handleReply} className="flex gap-2">
              <select
                value={replyIntent}
                onChange={(e) => setReplyIntent(e.target.value)}
                className="px-2 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--foreground)] text-xs focus:outline-none focus:border-[var(--accent)] w-24 flex-shrink-0"
              >
                <option value="answer">answer</option>
                <option value="question">question</option>
                <option value="update">update</option>
                <option value="request">request</option>
                <option value="ack">ack</option>
              </select>
              <input
                type="text"
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] text-sm"
              />
              <button
                type="submit"
                disabled={submitting || !replyBody.trim()}
                className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex-shrink-0"
              >
                {submitting ? "..." : "Send"}
              </button>
            </form>
          </div>
        </div>

        {/* Audit log panel (human users only) */}
        {showAuditLog && user.type === "human" && (
          <div className="w-72 border-l border-[var(--border)] overflow-y-auto flex-shrink-0">
            <div className="p-3 border-b border-[var(--border)] sticky top-0 bg-[var(--background)]">
              <h3 className="text-sm font-semibold">Activity Log</h3>
            </div>
            {loadingAudit ? (
              <div className="p-3 text-xs text-[var(--muted)]">Loading...</div>
            ) : auditLogs.length === 0 ? (
              <div className="p-3 text-xs text-[var(--muted)]">No events yet</div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {auditLogs.map((log) => (
                  <div key={log.id} className="p-3 text-xs">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`font-medium ${auditEventColor(log.event_type)}`}>
                        {formatEventType(log.event_type)}
                      </span>
                    </div>
                    {log.agent_name && (
                      <div className="text-[var(--muted)]">
                        by {log.agent_name}
                      </div>
                    )}
                    {log.details && Object.keys(log.details).length > 0 && (
                      <div className="text-[var(--muted)] mt-1 truncate">
                        {summarizeDetails(log.details)}
                      </div>
                    )}
                    <div className="text-[var(--muted)] mt-1">
                      {formatDateTime(log.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function auditEventColor(eventType: string): string {
  const colors: Record<string, string> = {
    message_sent: "text-emerald-400",
    message_read: "text-blue-400",
    rate_limit_hit: "text-amber-400",
    loop_detected: "text-red-400",
    loop_escalation: "text-red-500",
    auth_failure: "text-red-400",
    hmac_failure: "text-red-400",
    nonce_replay: "text-red-400",
    conversation_locked: "text-red-500",
  };
  return colors[eventType] || "text-[var(--muted)]";
}

function formatEventType(eventType: string): string {
  return eventType.replace(/_/g, " ");
}

function summarizeDetails(details: Record<string, unknown>): string {
  const parts: string[] = [];
  if (details.reason) parts.push(String(details.reason));
  if (details.intent) parts.push(`intent: ${details.intent}`);
  if (details.type) parts.push(String(details.type));
  if (details.error) parts.push(String(details.error));
  if (parts.length === 0) return JSON.stringify(details).slice(0, 60);
  return parts.join(" · ");
}
