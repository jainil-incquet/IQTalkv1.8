const express = require('express');
const { ExpressPeerServer } = require('peer');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const peerServer = ExpressPeerServer(server, {
  debug: false,
  allow_discovery: true,
  path: '/'
});
app.use('/peerjs', peerServer);

peerServer.on('connection', c => console.log('[peer+]', c.getId()));
peerServer.on('disconnect', c => console.log('[peer-]', c.getId()));

// socketId → { name, peerId }
const users = {};
// teamId → { name, members: [socketId], createdBy: socketId }
const teams = {};

function getUserList() {
  return Object.entries(users).map(([sid, u]) => ({
    socketId: sid,
    name: u.name,
    peerId: u.peerId
  }));
}

function getTeamList() {
  return Object.entries(teams).map(([tid, t]) => ({
    id: tid,
    name: t.name,
    createdBy: t.createdBy,
    members: t.members
      .filter(sid => users[sid])
      .map(sid => ({
        socketId: sid,
        name: users[sid].name,
        peerId: users[sid].peerId
      }))
  }));
}

io.on('connection', socket => {
  console.log('[socket+]', socket.id);

  socket.on('register', ({ name, peerId }) => {
    users[socket.id] = { name, peerId };
    io.emit('users-updated', getUserList());
    socket.emit('teams-updated', getTeamList());
    console.log('[user+]', name);
  });

  socket.on('create-team', ({ teamName }) => {
    const tid = 'team-' + Date.now();
    teams[tid] = { name: teamName, members: [socket.id], createdBy: socket.id };
    socket.join(tid);
    socket.emit('team-joined', { teamId: tid, teamName });
    io.emit('teams-updated', getTeamList());
    console.log('[team+]', teamName, 'by', users[socket.id]?.name);
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

app.get('/health', (req, res) => res.json({
  ok: true,
  users: Object.keys(users).length,
  teams: Object.keys(teams).length,
  time: new Date()
}));

// Start the server with dynamic port for Railway
const PORT = process.env.PORT || 3000;
server.listen(() => console.log(`IQTalk v2 running on port ${PORT}`));
