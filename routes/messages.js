const router = require('express').Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const auth = require('../middelware/auth');

router.get('/:conversationId', auth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: req.user.id
    });
    
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    const messages = await Message.find({ conversationId })
      .populate('senderId', 'name email role')
      .sort({ createdAt: 1 });
      
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { conversationId, text } = req.body;
    
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: req.user.id
    });
    
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    const message = await Message.create({
      conversationId,
      senderId: req.user.id,
      text,
      readBy: [req.user.id]
    });
    
    await message.populate('senderId', 'name email role');
    res.json(message);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:messageId/read', auth, async (req, res) => {
  try {
    const message = await Message.findByIdAndUpdate(
      req.params.messageId,
      { $addToSet: { readBy: req.user.id } },
      { new: true }
    );
    res.json(message);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;