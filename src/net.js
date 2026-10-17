// Peer-to-peer link between the expert and one novice, using PeerJS's free
// public broker only to introduce the two browsers. After that, messages go
// directly between them over WebRTC.
import Peer from 'peerjs';

const ID_PREFIX = 'cadshare-';

export function newRoomCode() {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Expert side: register the room and accept a single novice.
 * Callbacks: onOpen(), onJoin(), onLeave(), onMessage(msg), onError(err)
 */
export function hostRoom(room, cb) {
  const peer = new Peer(ID_PREFIX + room);
  let conn = null;

  peer.on('open', () => cb.onOpen?.());
  peer.on('error', (err) => cb.onError?.(err));
  peer.on('connection', (incoming) => {
    // Only one novice at a time; a reconnecting novice replaces a dead link.
    if (conn?.open) {
      incoming.on('open', () => incoming.close());
      return;
    }
    conn = incoming;
    conn.on('open', () => cb.onJoin?.());
    conn.on('data', (msg) => cb.onMessage?.(msg));
    conn.on('close', () => cb.onLeave?.());
  });

  return {
    send(msg) {
      if (conn?.open) conn.send(msg);
    },
  };
}

/**
 * Novice side: connect to the expert's room.
 * Callbacks: onOpen(), onLeave(), onMessage(msg), onError(err)
 */
export function joinRoom(room, cb) {
  const peer = new Peer();
  let conn = null;

  peer.on('error', (err) => cb.onError?.(err));
  peer.on('open', () => {
    conn = peer.connect(ID_PREFIX + room, { reliable: true });
    conn.on('open', () => cb.onOpen?.());
    conn.on('data', (msg) => cb.onMessage?.(msg));
    conn.on('close', () => cb.onLeave?.());
  });

  return {
    send(msg) {
      if (conn?.open) conn.send(msg);
    },
  };
}
