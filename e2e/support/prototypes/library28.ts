import { expect, type Page } from '@playwright/test'

/**
 * #28 Variant A, exactly as published: the static archive at `8787ba4`, variant A
 * ("Visual library"). Never rebuilt — the bytes in the archive are the prototype under
 * review (#39 §3, #28 resolution).
 */
export const LIBRARY_28 = {
  commit: '8787ba4',
  dir: 'prototype-static',
  entry: 'prototype-static/prototype-project-library.html',
  query: '?variant=A',
} as const

// The archive's own chrome. Selectors here follow the archive; when one stops matching,
// the preparer is wrong, the archive is not (#39 §3).
const notice = (page: Page) => page.locator('.prototype-notice')
const scenarioButton = (page: Page, label: string) =>
  page.locator('.scenario-controls').getByRole('button', { name: label, exact: true })
const headerButton = (page: Page, label: string) =>
  page.locator('header.app-header').getByRole('button', { name: label, exact: true })
const modal = (page: Page) => page.locator('.modal-backdrop')
const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name, exact: true })

/** Default view: the project list. */
export async function library(page: Page): Promise<void> {
  await expect(notice(page)).toBeVisible()
  await expect(heading(page, 'Pick up where you left off')).toBeVisible()
}

/** A save that failed, with the emergency-backup dialog open. */
export async function saveFailure(page: Page): Promise<void> {
  await scenarioButton(page, 'Simulate save failure').click()
  await expect(modal(page)).toBeVisible()
}

/** The import-collision dialog over the project list. */
export async function importCollision(page: Page): Promise<void> {
  await scenarioButton(page, 'Import collision').click()
  await expect(modal(page)).toBeVisible()
}

/** The Recovery Point picker. */
export async function recoveryPoint(page: Page): Promise<void> {
  await scenarioButton(page, 'Restore Recovery Point').click()
  await expect(modal(page)).toBeVisible()
}

/** The migration review page. */
export async function migrationReview(page: Page): Promise<void> {
  await headerButton(page, 'Migration review').click()
  await expect(heading(page, 'Review where your existing work belongs')).toBeVisible()
}

/** The permanent-delete confirmation, reached through Trash. */
export async function permanentDelete(page: Page): Promise<void> {
  await headerButton(page, 'Trash').click()
  await expect(heading(page, 'Deleted Projects')).toBeVisible()
  await page.getByRole('button', { name: 'Delete permanently', exact: true }).first().click()
  await expect(modal(page)).toBeVisible()
}
