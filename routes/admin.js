const router = require('express').Router();
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const auth = require('../middelware/auth');

const adminAuth = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied. Admin only.' });
  }
  next();
};

router.get('/stats', auth, adminAuth, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalMessages = await Message.countDocuments();
    const totalConversations = await Conversation.countDocuments();
    
    const activeUsers = await User.countDocuments({
      lastSeen: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
    });
    
    const offlineUsers = totalUsers - activeUsers;
    
    const usersByRole = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]);
    
    const messagesByDay = await Message.aggregate([
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': -1, '_id.month': -1, '_id.day': -1 } },
      { $limit: 7 }
    ]);
    
    const recentUsers = await User.find()
      .select('name email role createdAt lastSeen')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      overview: {
        totalUsers,
        activeUsers,
        offlineUsers,
        totalMessages,
        totalConversations
      },
      usersByRole,
      messagesByDay,
      recentUsers
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/users', auth, adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    const role = req.query.role || '';
    const status = req.query.status || '';

    const filter = {};
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (role) {
      filter.role = role;
    }
    
    if (status === 'active') {
      filter.lastSeen = { $gte: new Date(Date.now() - 5 * 60 * 1000) };
    } else if (status === 'offline') {
      filter.lastSeen = { $lt: new Date(Date.now() - 5 * 60 * 1000) };
    }

    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(filter);

    res.json({
      users,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/messages', auth, adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const conversationId = req.query.conversationId || '';

    const filter = {};
    if (conversationId) {
      filter.conversationId = conversationId;
    }

    const messages = await Message.find(filter)
      .populate('senderId', 'name email role')
      .populate('conversationId', 'participants')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Message.countDocuments(filter);

    res.json({
      messages,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/conversations', auth, adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const conversations = await Conversation.find()
      .populate('participants', 'name email role')
      .populate('lastMessage')
      .sort({ updatedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Conversation.countDocuments();

    res.json({
      conversations,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:userId/status', auth, adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      { isActive },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User status updated', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:userId', auth, adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    if (userId === req.user.id) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    await Message.deleteMany({ senderId: userId });
    await Conversation.updateMany(
      { participants: userId },
      { $pull: { participants: userId } }
    );
    await Conversation.deleteMany({ participants: { $size: 0 } });
    
    await User.findByIdAndDelete(userId);

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/analytics', auth, adminAuth, async (req, res) => {
  try {
    const { period = '7d' } = req.query;
    
    let dateFilter;
    switch (period) {
      case '24h':
        dateFilter = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        dateFilter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        dateFilter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        dateFilter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    }

    const newUsers = await User.aggregate([
      { $match: { createdAt: { $gte: dateFilter } } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    const messagesOverTime = await Message.aggregate([
      { $match: { createdAt: { $gte: dateFilter } } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    const mostActiveUsers = await Message.aggregate([
      { $match: { createdAt: { $gte: dateFilter } } },
      { $group: { _id: '$senderId', messageCount: { $sum: 1 } } },
      { $sort: { messageCount: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $project: {
          messageCount: 1,
          'user.name': 1,
          'user.email': 1,
          'user.role': 1
        }
      }
    ]);

    res.json({
      period,
      newUsers,
      messagesOverTime,
      mostActiveUsers
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;