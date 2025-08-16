const router = require('express').Router();
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const auth = require('../middelware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user.id
    }).populate('participants', 'name email role');
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { participants } = req.body;
    const allParticipants = [...new Set([...participants, req.user.id])];
    
    const conversation = await Conversation.create({
      participants: allParticipants
    });
    
    await conversation.populate('participants', 'name email role');
    res.json(conversation);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;