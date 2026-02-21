/**
 * Validates a National Provider Identifier (NPI) using the CMS Luhn check digit algorithm.
 *
 * The NPI is a 10-digit number where the last digit is a check digit calculated
 * using the ISO standard Luhn Formula (Modulus 10 "double-add-double").
 *
 * For 10-position NPIs, a constant of 24 is added to the sum to account for the
 * implicit "80840" prefix (80 = health applications, 840 = United States).
 *
 * @param npi - The NPI string to validate
 * @returns true if the NPI is valid, false otherwise
 *
 * @see https://www.eclaims.com/articles/how-to-calculate-the-npi-check-digit/
 */
export function isValidNpi(npi: string): boolean {
  // Must be exactly 10 digits
  if (!/^\d{10}$/.test(npi)) {
    return false
  }

  const digits = npi.split('').map(Number)

  // Constant for 10-position NPI, accounts for "80840" prefix
  let sum = 24

  // Process digits from right to left
  // The check digit is at position 9 (rightmost)
  // Starting from position 8, double every other digit moving left
  for (let i = digits.length - 2; i >= 0; i--) {
    // Positions from right: 1 (idx 8), 2 (idx 7), 3 (idx 6), etc.
    const positionFromRight = digits.length - 1 - i
    const shouldDouble = positionFromRight % 2 === 1

    if (shouldDouble) {
      let doubled = digits[i] * 2
      // If doubled value > 9, subtract 9 (equivalent to summing individual digits)
      if (doubled > 9) {
        doubled -= 9
      }
      sum += doubled
    } else {
      sum += digits[i]
    }
  }

  // Add the check digit (last digit)
  sum += digits[digits.length - 1]

  // Valid if total is divisible by 10
  return sum % 10 === 0
}
