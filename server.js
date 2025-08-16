require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const authRoutes = require('./routes/auth');
const connectDB = require('./config/db');
const conversationRoutes = require('./routes/conversations');
const messageRoutes = require('./routes/messages');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);

connectDB();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Chat Backend is running');
});

app.use('/auth', authRoutes);
app.use('/conversations', conversationRoutes);
app.use('/messages', messageRoutes);

const io = new Server(server, {
  cors: { origin: '*' }
});

const activeUsers = new Map();

io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);

  socket.on('user_join', (userId) => {
    activeUsers.set(userId, socket.id);
    socket.userId = userId;
    console.log(`User ${userId} joined`);
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

  socket.on('disconnect', () => {
    if (socket.userId) {
      activeUsers.delete(socket.userId);
    }
    console.log('User disconnected:', socket.id);
  });
});


const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
