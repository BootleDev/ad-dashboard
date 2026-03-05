"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatBox() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput("");
    const updated = [...messages, { role: "user" as const, content: userMsg }];
    setMessages(updated);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg }),
      });

      const data = await res.json();
      setMessages([...updated, { role: "assistant", content: data.reply || data.error }]);
    } catch {
      setMessages([...updated, { role: "assistant", content: "Error connecting to AI" }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="rounded-xl flex flex-col"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border)", height: "400px" }}
    >
      <div className="px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          AI Analyst
        </h3>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Ask about your ad performance...
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`text-sm rounded-lg px-3 py-2 max-w-[85%] ${
              msg.role === "user" ? "ml-auto" : ""
            }`}
            style={{
              background: msg.role === "user" ? "var(--accent-blue)" : "var(--bg-secondary)",
              color: "var(--text-primary)",
              whiteSpace: "pre-wrap",
            }}
          >
            {msg.content}
          </div>
        ))}
        {loading && (
          <div
            className="text-sm rounded-lg px-3 py-2"
            style={{ background: "var(--bg-secondary)" }}
          >
            <span className="animate-pulse">Thinking...</span>
          </div>
        )}
      </div>

      <div className="p-3 border-t flex gap-2" style={{ borderColor: "var(--border)" }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="e.g. Which ad has the best ROAS?"
          className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
          style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        />
        <button
          onClick={handleSend}
          disabled={loading}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: "var(--accent-blue)", color: "#fff" }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
