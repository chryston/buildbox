import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '../support/fixtures'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/legacy')
const fileInput = 'input[type="file"]'

const upload = (name: string, body: string | Buffer) => ({
  name,
  mimeType: 'application/json',
  buffer: Buffer.isBuffer(body) ? body : Buffer.from(body),
})

const malformed = JSON.stringify({
  version: 1,
  projects: [{ name: 'No id, no cabinets', root: { id: 'n0' } }],
})

// The import writes to this browser's storage, so it is excluded from the live smoke run.
// @local-only is the grep-invert tag static.yml's smoke-live job uses.
test('a malformed workspace file is refused and changes nothing @local-only', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByTestId('cabinet-canvas')).toBeVisible()
  const voids = page.getByTestId(/^void-/)
  await expect(voids).toHaveCount(1)

  await page.setInputFiles(fileInput, upload('broken.buildbox.json', malformed))
  await expect(page.getByRole('heading', { name: /can't be imported/i })).toBeVisible()
  await expect(page.getByTestId('problem-list')).toContainText('projects[0].id — Missing an id.')
  await expect(page.getByTestId('problem-list')).toContainText('projects[0].units — Missing the cabinets in this project.')
  await expect(page.getByRole('button', { name: 'Replace workspace' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByTestId('problem-list')).toHaveCount(0)

  // The workspace the user was working on is untouched: same project, still editable.
  await expect(page.getByRole('button', { name: 'Cabinet 1', exact: true })).toBeVisible()
  await expect(voids).toHaveCount(1)
  await voids.first().click({ position: { x: 10, y: 10 } })
  await page.getByRole('button', { name: 'Add Shelf' }).click()
  await expect(voids).toHaveCount(2)
})

test('a file from a newer BuildBox is refused @local-only', async ({ page }) => {
  await page.goto('./')
  await page.setInputFiles(fileInput, upload('future.buildbox.json', JSON.stringify({ version: 2, projects: [] })))
  await expect(page.getByTestId('problem-list')).toContainText('This file was written by a newer version of BuildBox.')
})

const workspaceFixtures = [
  { file: 'active-project.buildbox.json', names: ['Kitchen Wall'] },
  { file: 'all-projects.buildbox.json', names: ['Kitchen Wall', 'Bathroom Vanity'] },
  { file: 'v0-design-shape.buildbox.json', names: ['Legacy Closet'] },
]

for (const fixture of workspaceFixtures) {
  test(`importing ${fixture.file} through the toolbar works @local-only`, async ({ page }) => {
    const raw = readFileSync(join(fixturesRoot, 'workspace', fixture.file), 'utf8')
    await page.goto('./')
    await expect(page.getByTestId('cabinet-canvas')).toBeVisible()

    await page.setInputFiles(fileInput, upload(fixture.file, raw))
    await expect(page.getByRole('button', { name: 'Replace workspace' })).toBeVisible()
    await page.getByRole('button', { name: 'Replace workspace' }).click()

    for (const name of fixture.names) {
      // exact: each tab also renders a "Delete <name>" button, which substring matching
      // would pick up.
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Cabinet 1', exact: true })).toHaveCount(0)
    await expect(page.getByTestId(/^void-/)).not.toHaveCount(0)
  })
}
