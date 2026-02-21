import { describe, it, expect } from 'vitest'
import { isValidNpi } from './npi.js'

describe('isValidNpi', () => {
  describe('valid NPIs', () => {
    it('should accept known valid NPI 1234567893', () => {
      expect(isValidNpi('1234567893')).toBe(true)
    })

    it('should accept known valid NPI 1245319599', () => {
      expect(isValidNpi('1245319599')).toBe(true)
    })

    it('should accept known valid NPI 1003000126', () => {
      expect(isValidNpi('1003000126')).toBe(true)
    })
  })

  describe('invalid check digits', () => {
    it('should reject NPI with wrong check digit (1234567890)', () => {
      expect(isValidNpi('1234567890')).toBe(false)
    })

    it('should reject NPI with wrong check digit (1234567891)', () => {
      expect(isValidNpi('1234567891')).toBe(false)
    })

    it('should reject NPI with wrong check digit (1245319590)', () => {
      expect(isValidNpi('1245319590')).toBe(false)
    })
  })

  describe('format validation', () => {
    it('should reject strings shorter than 10 digits', () => {
      expect(isValidNpi('123456789')).toBe(false)
    })

    it('should reject strings longer than 10 digits', () => {
      expect(isValidNpi('12345678901')).toBe(false)
    })

    it('should reject empty string', () => {
      expect(isValidNpi('')).toBe(false)
    })

    it('should reject non-numeric strings', () => {
      expect(isValidNpi('123456789a')).toBe(false)
    })

    it('should reject all-alpha strings', () => {
      expect(isValidNpi('abcdefghij')).toBe(false)
    })

    it('should reject strings with spaces', () => {
      expect(isValidNpi('123 456 78')).toBe(false)
    })

    it('should reject strings with hyphens', () => {
      expect(isValidNpi('123-456-78')).toBe(false)
    })
  })
})
