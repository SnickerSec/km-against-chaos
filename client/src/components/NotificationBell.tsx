"use client";

import { useState, useEffect, useRef } from "react";
import { useAuthStore } from "@/lib/auth";
import { useFriendsStore } from "@/lib/friendsStore";
import { fetchNotifications, markNotificationRead, markAllNotificationsRead, getVapidPublicKey, subscribePush } from "@/lib/api";

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(date).toLocaleDateString();
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export default function NotificationBell() {
  const user = useAuthStore((s) => s.user);
  const { notifications, setNotifications, markNotificationRead: markRead } = useFriendsStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!user) return;
    fetchNotifications().then(setNotifications).catch(() => {});

    // Subscribe to web push notifications
    if ("serviceWorker" in navigator && "PushManager" in window) {
      (async () => {
        try {
          const vapidKey = await getVapidPublicKey();
          if (!vapidKey) return;
          const reg = await navigator.serviceWorker.ready;
          const existing = await reg.pushManager.getSubscription();
          if (existing) {
            await subscribePush(existing);
            return;
          }
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
          });
          await subscribePush(sub);
        } catch {}
      })();
    }
  }, [user, setNotifications]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!user) return null;

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead();
    setNotifications(notifications.map((n) => ({ ...n, read: true })));
  };

  const handleClick = async (id: string) => {
    await markNotificationRead(id);
    markRead(id);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-1.5 text-gray-400 hover:text-white transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
            <p className="text-sm font-medium text-white">Notifications</p>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="text-xs text-purple-400 hover:text-purple-300">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="text-gray-500 text-sm p-4 text-center">No notifications</p>
            ) : (
              notifications.slice(0, 20).map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-700/50 hover:bg-gray-700 transition-colors ${
                    n.read ? "opacity-60" : ""
                  }`}
                >
                  <p className="text-sm text-gray-200">
                    {n.type === "friend_request" && `${n.data?.fromName || "Someone"} sent you a friend request`}
                    {n.type === "friend_accepted" && `${n.data?.fromName || n.data?.name || "Someone"} accepted your friend request`}
                    {n.type === "game_invite" && `${n.data?.fromName || "Someone"} invited you to play ${n.data?.deckName || ""}`}
                    {!["friend_request", "friend_accepted", "game_invite"].includes(n.type) && (n.data?.message || "New notification")}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{timeAgo(n.created_at)}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
