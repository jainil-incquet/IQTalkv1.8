const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io (Buffer size kept large just in case, though chunks are tiny)
const io = new Server(server, { 
  cors: { origin: '*' },
  maxHttpBufferSize: 1000000000 // 1GB for audio blobs/chunks
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

  // 3. Live Audio Streaming & Presence Routing
  
  // a. Announce the stream is starting (Replaces person-talk-started)
  socket.on('stream-start', ({ targetType, targetId, mimeType }) => {
    const payload = { senderId: socket.id, mimeType };
    
    if (targetType === 'team') {
      socket.to(targetId).emit('incoming-stream-start', payload);
    } else if (targetType === 'user') {
      io.to(targetId).emit('incoming-stream-start', payload);
    }
  });

  // b. Relay the continuous data chunks as fast as possible (Replaces transmit-audio)
  socket.on('stream-chunk', ({ targetType, targetId, audioChunk }) => {
    // audioChunk arrives as a raw binary Buffer
    const payload = { senderId: socket.id, audioChunk };
    
    if (targetType === 'team') {
      socket.to(targetId).emit('incoming-stream-chunk', payload);
    } else if (targetType === 'user') {
      io.to(targetId).emit('incoming-stream-chunk', payload);
    }
  });

  // c. Announce the stream is over (Replaces person-talk-stopped)
  socket.on('stream-stop', ({ targetType, targetId }) => {
    const payload = { senderId: socket.id };

    if (targetType === 'team') {
      socket.to(targetId).emit('incoming-stream-stop', payload);
    } else if (targetType === 'user') {
      io.to(targetId).emit('incoming-stream-stop', payload);
    }
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
server.listen(PORT, () => console.log(`IQTalk Streaming Socket Server running on port ${PORT}`));