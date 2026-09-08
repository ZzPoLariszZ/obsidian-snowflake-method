/** Damaged sections must remain byte-identical when a scene edit is refused. */
import { describe, expect, it } from 'vitest';
import { SnowflakeProjectService } from '../../src/services';
import { UnsafeSectionError } from '../../src/repository';
import { createFakeEnvironment } from '../helpers/fake-vault';

describe('Claude finding 1: real scene service with edited note contents', () => {
  it.each(['both', 'end', 'duplicate'] as const)('%s markers', async (damage) => {
    const env = createFakeEnvironment();
    const service = new SnowflakeProjectService(env.vault, env.fileManager, env.metadataCache);
    const project = await service.createProject({ name: 'Marker verification', locale: 'en' });
    const created = await service.createScene(project, {
      title: 'Arrival', events: 'The author wrote this event.', conflict: 'Old conflict',
    });
    const original = env.fakeVault.contents.get(created.path)!;
    const start = '<!-- snowflake:section:scene-events:start -->';
    const end = '<!-- snowflake:section:scene-events:end -->';
    const damaged = damage === 'both'
      ? original.replace(start, '').replace(end, '')
      : damage === 'end' ? original.replace(end, '') : original.replace(start, `${start}\n${start}`);
    env.fakeVault.write(created.path, damaged);
    const scene = (await service.loadProject(project)).scenes[0]!;
    expect(scene.sectionHealth.issues).toContainEqual(expect.objectContaining({
      sectionId: 'scene-events',
      code: damage === 'both' ? 'missing' : damage === 'end' ? 'missing-end' : 'duplicate-start',
    }));
    const update = service.updateScene(project, scene.sceneId, {
      expectedRevision: scene.revision, conflict: 'Changed on corkboard',
    });
    await expect(update).rejects.toBeInstanceOf(UnsafeSectionError);
    expect(env.fakeVault.contents.get(created.path)).toBe(damaged);
  });
});
