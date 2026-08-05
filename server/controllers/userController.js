const User = require('../models/User');
const { asyncHandler } = require('../utils/helpers');

/** GET /api/users — list all users (id/name/email only, for filter dropdowns). */
const list = asyncHandler(async (req, res) => {
  const users = await User.find().select('name email').sort({ name: 1 });
  res.json({ users });
});

module.exports = { list };
