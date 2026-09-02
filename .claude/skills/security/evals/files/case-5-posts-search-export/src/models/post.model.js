const mongoose = require('mongoose');

const postSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 160, trim: true },
    body: { type: String, required: true, maxlength: 40000 },
    tags: {
      type: [{ type: String, maxlength: 32 }],
      default: [],
      validate: (v) => v.length <= 10,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    isPublished: { type: Boolean, default: false, index: true },
    isFeatured: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Post', postSchema);
