import { render, screen } from '@testing-library/react'
import App from './App'

test('renders the BuildBox app shell title', () => {
  render(<App />)

  expect(screen.getByText('BuildBox')).toBeInTheDocument()
})
