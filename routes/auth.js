const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { request } = require('express');

// Signup
router.post('/signup', async (req, res) => {
   
 // res.json({ request: req.body });

  try {
    const user = await User.create(req.body);
    res.json({ user: user, message: 'User created successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET);
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
