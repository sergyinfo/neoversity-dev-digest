const { exec, execFile } = require('child_process');
const path = require('path');

const Post = require('../models/post.model');

const PAGE_SIZE = 20;
const EXPORT_DIR = '/srv/blogapp/exports';
const TEMPLATE_DIR = '/srv/blogapp/templates';

async function list(req, res, next) {
  try {
    const page = Number.parseInt(req.query.page, 10) || 1;
    const posts = await Post.find({ isPublished: true })
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .populate('author', 'name');

    return res.json(posts);
  } catch (err) {
    return next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const post = await Post.findOne({ _id: req.params.id, isPublished: true });
    if (!post) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json(post);
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const post = await Post.create(req.body);
    return res.status(201).json(post);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (post.author.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { title, body, tags } = req.body;
    if (title !== undefined) post.title = String(title);
    if (body !== undefined) post.body = String(body);
    if (Array.isArray(tags)) post.tags = tags.map(String);

    await post.save();
    return res.json(post);
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const post = await Post.findByIdAndDelete(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
}

function buildThumbnail(sourcePath) {
  return new Promise((resolve, reject) => {
    execFile(
      'convert',
      [sourcePath, '-resize', '320x240', `${sourcePath}.thumb.jpg`],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

function exportPdf(req, res, next) {
  const target = path.join(EXPORT_DIR, `${req.params.id}.pdf`);
  const template = req.query.template || 'default';

  exec(
    `wkhtmltopdf ${TEMPLATE_DIR}/${template}.html ${target}`,
    { timeout: 30000 },
    (err) => {
      if (err) return next(err);
      return res.download(target);
    }
  );
}

module.exports = {
  list,
  getOne,
  create,
  update,
  remove,
  exportPdf,
  buildThumbnail,
};
