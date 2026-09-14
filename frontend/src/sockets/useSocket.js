import { useEffect, useRef } from "react";
import { io } from "socket.io-client";

let globalSocket = null;

/**
 * Returns a singleton Socket.io client.
 * Joins a specific trip room and leaves it on cleanup.
 */
export function useSocket(tripId, onSeatEvent) {
  const callbackRef = useRef(onSeatEvent);
  callbackRef.current = onSeatEvent;

  useEffect(() => {
    if (!tripId) return;

    if (!globalSocket) {
      const socketUrl = import.meta.env.VITE_API_URL || window.location.origin;
      globalSocket = io(socketUrl, {
        transports: ["websocket", "polling"],
        withCredentials: false,
      });
    }

    const socket = globalSocket;
    const room = `trip:${tripId}`;
    socket.emit("join:trip", tripId);

    const handler = (data) => callbackRef.current?.(data);
    socket.on("seat:held", handler);
    socket.on("seat:released", handler);
    socket.on("seat:booked", handler);

    return () => {
      socket.emit("leave:trip", tripId);
      socket.off("seat:held", handler);
      socket.off("seat:released", handler);
      socket.off("seat:booked", handler);
    };
  }, [tripId]);
}
