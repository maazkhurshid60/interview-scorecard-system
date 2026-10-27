import PipelineTemplate from '../models/PipelineTemplate.js';
import { plain } from './plain.js';

/**
 * Everything the app needs from the database about hiring process templates (the stage lists a job opening is
 * created from). Only this file (and the model) knows where they live.
 */

/** All templates, sorted by name. */
export async function listAll() {
  return plain(await PipelineTemplate.find().sort({ name: 1 }));
}

/** One template, or null when there is none with that id. */
export async function findById(id) {
  return plain(await PipelineTemplate.findById(id));
}

/** The template flagged as the default, or null. */
export async function findDefault() {
  return plain(await PipelineTemplate.findOne({ isDefault: true }));
}

/** Creates a template and returns it. */
export async function create({ name, description, stages, autoWeights, isDefault }) {
  return plain(await PipelineTemplate.create({ name, description, stages, autoWeights, isDefault }));
}

/**
 * Changes the given fields of a template (name, description, stages, autoWeights; fields left out stay as they are)
 * and returns the saved template, or null when it does not exist.
 */
export async function update(id, changes) {
  const template = await PipelineTemplate.findById(id);
  if (!template) return null;
  for (const field of ['name', 'description', 'autoWeights', 'stages']) {
    if (changes[field] !== undefined) template[field] = changes[field];
  }
  await template.save();
  return plain(template);
}

/** Makes this template the one default (every other template stops being the default). Null when it does not exist. */
export async function makeDefault(id) {
  const template = await PipelineTemplate.findById(id);
  if (!template) return null;
  await PipelineTemplate.updateMany({ _id: { $ne: template._id } }, { $set: { isDefault: false } });
  template.isDefault = true;
  await template.save();
  return plain(template);
}

/** Deletes a template. */
export async function remove(id) {
  await PipelineTemplate.findByIdAndDelete(id);
}
