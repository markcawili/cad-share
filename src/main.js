// Entry point: picks the role from the URL.
//   no ?room          → landing page (start as expert)
//   ?room=X&role=expert → expert
//   ?room=X           → novice (the invite link)
import { $ } from './ui.js';
import { newRoomCode } from './net.js';
import { startExpert } from './expert.js';
import { startNovice } from './novice.js';

const params = new URLSearchParams(location.search);
const room = params.get('room');

if (!room) {
  $('landing').classList.remove('hidden');
  $('start-expert').addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.set('room', newRoomCode());
    url.searchParams.set('role', 'expert');
    history.replaceState(null, '', url);
    $('landing').classList.add('hidden');
    startExpert(url.searchParams.get('room'));
  });
} else if (params.get('role') === 'expert') {
  startExpert(room);
} else {
  startNovice(room);
}
