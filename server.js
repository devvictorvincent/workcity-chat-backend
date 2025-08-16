require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const { Server } = require('socket.io');
const authRoutes = require('./routes/auth');
const connectDB = require('./config/db');
const conversationRoutes = require('./routes/conversations');
const messageRoutes = require('./routes/messages');
const profileRoutes = require('./routes/profile');
const adminRoutes = require('./routes/admin');
const Message = require('./models/Message');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);

connectDB();

app.use(cors());
app.use(express.json());

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.send('Chat Backend is running');
});

app.use('/auth', authRoutes);
app.use('/conversations', conversationRoutes);
app.use('/messages', messageRoutes);
app.use('/profile', profileRoutes);
app.use('/admin', adminRoutes);

const io = new Server(server, {
  cors: { origin: '*' }
});

const activeUsers = new Map();

const updateUserLastSeen = async (userId) => {
  try {
    await User.findByIdAndUpdate(userId, { lastSeen: new Date() });
  } catch (error) {
    console.error('Error updating user last seen:', error);
  }
};

io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);

  socket.on('user_join', async (userId) => {
    activeUsers.set(userId, socket.id);
    socket.userId = userId;
    await updateUserLastSeen(userId);
    console.log(`User ${userId} joined`);
    
    io.emit('user_status_update', {
      userId,
      status: 'online',
      totalActiveUsers: activeUsers.size
    });
  });

  socket.on('join_conversation', (conversationId) => {
    socket.join(conversationId);
    console.log(`User joined conversation: ${conversationId}`);
  });

  socket.on('send_message', async (data) => {
    try {
      const { conversationId, text, senderId } = data;
      
      const message = await Message.create({
        conversationId,
        senderId,
        text,
        readBy: [senderId]
      });
      
      await message.populate('senderId', 'name email role');
      await updateUserLastSeen(senderId);
      
      io.to(conversationId).emit('receive_message', message);
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('message_error', { error: error.message });
    }
  });

  socket.on('typing_start', (data) => {
    socket.to(data.conversationId).emit('user_typing', {
      userId: socket.userId,
      conversationId: data.conversationId
    });
  });

  socket.on('typing_stop', (data) => {
    socket.to(data.conversationId).emit('user_stop_typing', {
      userId: socket.userId,
      conversationId: data.conversationId
    });
  });

  socket.on('disconnect', async () => {
    if (socket.userId) {
      activeUsers.delete(socket.userId);
      await updateUserLastSeen(socket.userId);
      
      io.emit('user_status_update', {
        userId: socket.userId,
        status: 'offline',
        totalActiveUsers: activeUsers.size
      });
    }
    console.log('User disconnected:', socket.id);
  });
});

setInterval(async () => {
  for (const [userId] of activeUsers) {
    await updateUserLastSeen(userId);
  }
}, 60000);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
