const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io with a large buffer size to handle audio blobs
const io = new Server(server, { 
  cors: { origin: '*' },
  maxHttpBufferSize: 1e7 // 10MB limit for audio chunks
});

app.use(express.static(path.join(__dirname, 'public')));

// State Management
// socketId → { socketId, name }
const users = {};
// teamId → { name, members: [socketId], createdBy: socketId }
const teams = {};

function getUserList() {
  return Object.values(users);
}

function getTeamList() {
  return Object.entries(teams).map(([tid, t]) => ({
    id: tid,
    name: t.name,
    createdBy: t.createdBy,
    members: t.members
      .filter(sid => users[sid])
      .map(sid => users[sid])
  }));
}

io.on('connection', socket => {
  console.log('[socket+]', socket.id);

  // 1. User Registration
  socket.on('register', ({ name }) => {
    users[socket.id] = { socketId: socket.id, name };
    io.emit('users-updated', getUserList());
    socket.emit('teams-updated', getTeamList());
    console.log('[user+]', name);
  });

  // 2. Team Management
  socket.on('create-team', ({ teamName }) => {
    const tid = 'team-' + Date.now();
    teams[tid] = { name: teamName, members: [socket.id], createdBy: socket.id };
    socket.join(tid);
    socket.emit('team-joined', { teamId: tid, teamName });
    io.emit('teams-updated', getTeamList());
  });

  socket.on('join-team', ({ teamId }) => {
    const team = teams[teamId];
    if (!team) return;
    if (!team.members.includes(socket.id)) {
      team.members.push(socket.id);
      socket.join(teamId);
    }
    socket.emit('team-joined', { teamId, teamName: team.name });
    io.emit('teams-updated', getTeamList());
  });

  socket.on('leave-team', ({ teamId }) => {
    const team = teams[teamId];
    if (!team) return;
    team.members = team.members.filter(id => id !== socket.id);
    socket.leave(teamId);
    if (team.members.length === 0) delete teams[teamId];
    io.emit('teams-updated', getTeamList());
  });

  // 3. Audio & Presence Routing
  socket.on('transmit-audio', (payload) => {
    const { targetType, targetId, audioBlob, mimeType } = payload;
    const data = {
      senderId: socket.id,
      senderName: users[socket.id]?.name || 'Unknown',
      audioBlob,
      mimeType,
      targetType
    };

    if (targetType === 'team') {
      socket.to(targetId).emit('receive-audio', data);
    } else if (targetType === 'user') {
      io.to(targetId).emit('receive-audio', data);
    }
  });

  // UI Indicators for "Speaking" state
  socket.on('ptt-start', ({ targetType, targetId }) => {
    if (targetType === 'team') socket.to(targetId).emit('ptt-started', { senderId: socket.id });
    else if (targetType === 'user') io.to(targetId).emit('ptt-started', { senderId: socket.id });
  });

  socket.on('ptt-stop', ({ targetType, targetId }) => {
    if (targetType === 'team') socket.to(targetId).emit('ptt-stopped', { senderId: socket.id });
    else if (targetType === 'user') io.to(targetId).emit('ptt-stopped', { senderId: socket.id });
  });
  

  // 4. Cleanup on disconnect
  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (!user) return;
    console.log('[user-]', user.name);
    Object.keys(teams).forEach(tid => {
      teams[tid].members = teams[tid].members.filter(id => id !== socket.id);
      if (teams[tid].members.length === 0) delete teams[tid];
    });
    delete users[socket.id];
    io.emit('users-updated', getUserList());
    io.emit('teams-updated', getTeamList());
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`IQTalk Socket Server running on port ${PORT}`));