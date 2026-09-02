const path = require('path');
const mongoose = require('mongoose');

const Post = require('../models/post.model');
const { renderTemplate } = require('../lib/render');
const { buildFilter } = require('../lib/query');

const PAGE_SIZE = 20;
const EXPORT_DIR = '/srv/blogapp/exports';
const TEMPLATE_DIR = '/srv/blogapp/templates';
const DEFAULT_TEMPLATE = path.join(TEMPLATE_DIR, 'default.html');

function pageOf(query) {
  const parsed = Number.parseInt(query.page, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), 500);
}

async function list(req, res, next) {
  try {
    const page = pageOf(req.query);
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

async function search(req, res, next) {
  try {
    const filter = buildFilter(req.query);
    const posts = await Post.find(filter)
      .sort({ createdAt: -1 })
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
    const { title, body, tags } = req.body;
    const post = await Post.create({
      title: String(title ?? ''),
      body: String(body ?? ''),
      tags: Array.isArray(tags) ? tags.slice(0, 10).map(String) : [],
      author: req.user.userId,
    });
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
    if (post.author.toString() !== req.body.authorId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { title, body, tags } = req.body;
    if (title !== undefined) post.title = String(title);
    if (body !== undefined) post.body = String(body);
    if (Array.isArray(tags)) post.tags = tags.slice(0, 10).map(String);

    await post.save();
    return res.json(post);
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const filter =
      req.user.role === 'admin'
        ? { _id: req.params.id }
        : { _id: req.params.id, author: req.user.userId };

    const post = await Post.findOneAndDelete(filter);
    if (!post) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
}

async function exportPdf(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const target = path.join(EXPORT_DIR, `${req.params.id}.pdf`);
    await renderTemplate(DEFAULT_TEMPLATE, target);
    return res.download(target);
  } catch (err) {
    return next(err);
  }
}

async function exportBranded(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const template = path.join(TEMPLATE_DIR, `${req.query.template || 'default'}.html`);
    const target = path.join(EXPORT_DIR, `${req.params.id}-branded.pdf`);
    await renderTemplate(template, target);
    return res.download(target);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  list,
  search,
  getOne,
  create,
  update,
  remove,
  exportPdf,
  exportBranded,
};
