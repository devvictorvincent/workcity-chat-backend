const router = require('express').Router();
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const auth = require('../middelware/auth');
const bcrypt = require('bcryptjs');

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

router.post('/users', auth, adminAuth, async (req, res) => {
  try {
    const { name, email, password, role, bio, phone, address, preferences } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    const validRoles = ['admin', 'agent', 'customer', 'designer', 'merchant'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role specified' });
    }

    const userData = {
      name,
      email,
      password,
      role: role || 'customer',
      bio: bio || '',
      phone: phone || '',
      address: address || {
        street: '',
        city: '',
        state: '',
        zipCode: '',
        country: ''
      },
      preferences: preferences || {
        notifications: true,
        emailNotifications: true,
        darkMode: false
      },
      isActive: true
    };

    const user = await User.create(userData);
    const userResponse = await User.findById(user._id).select('-password');

    res.status(201).json({
      message: 'User created successfully',
      user: userResponse
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/users/:userId', auth, adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userStats = {
      totalMessages: await Message.countDocuments({ senderId: userId }),
      totalConversations: await Conversation.countDocuments({ participants: userId }),
      recentMessages: await Message.find({ senderId: userId })
        .populate('conversationId', 'participants')
        .sort({ createdAt: -1 })
        .limit(5)
    };

    res.json({
      user,
      stats: userStats
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:userId', auth, adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, email, role, bio, phone, address, preferences, isActive } = req.body;

    if (userId === req.user.id && isActive === false) {
      return res.status(400).json({ message: 'Cannot deactivate your own account' });
    }

    const updateFields = {};
    if (name !== undefined) updateFields.name = name;
    if (email !== undefined) {
      const existingUser = await User.findOne({ email, _id: { $ne: userId } });
      if (existingUser) {
        return res.status(400).json({ message: 'Email already exists' });
      }
      updateFields.email = email;
    }
    if (role !== undefined) {
      const validRoles = ['admin', 'agent', 'customer', 'designer', 'merchant'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ message: 'Invalid role specified' });
      }
      updateFields.role = role;
    }
    if (bio !== undefined) updateFields.bio = bio;
    if (phone !== undefined) updateFields.phone = phone;
    if (address !== undefined) updateFields.address = address;
    if (preferences !== undefined) updateFields.preferences = preferences;
    if (isActive !== undefined) updateFields.isActive = isActive;

    const user = await User.findByIdAndUpdate(
      userId,
      updateFields,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'User updated successfully',
      user
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/users/:userId/password', auth, adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ message: 'New password is required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:userId/status', auth, adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    if (userId === req.user.id && isActive === false) {
      return res.status(400).json({ message: 'Cannot deactivate your own account' });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { isActive },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ 
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`, 
      user 
    });
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

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    await Message.deleteMany({ senderId: userId });
    await Conversation.updateMany(
      { participants: userId },
      { $pull: { participants: userId } }
    );
    await Conversation.deleteMany({ participants: { $size: 0 } });
    
    await User.findByIdAndDelete(userId);

    res.json({ message: 'User and associated data deleted successfully' });
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