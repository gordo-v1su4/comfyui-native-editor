// Simple test script to verify login logic
const testData = {
  username: "alice",
  password: "secret"
};

console.log("Testing login logic with:", testData);

// Simulate the login validation logic
let { email, username, password } = testData;

// Debug logging
console.log("Extracted values:", { email, username, password });

// Validate required fields
if (!password) {
  console.log("ERROR: Missing password");
  process.exit(1);
}

if (!email && !username) {
  console.log("ERROR: Missing email or username");
  process.exit(1);
}

console.log("✅ Validation passed - both username and password are present");
console.log("The login endpoint should now proceed to authenticate the user");

















