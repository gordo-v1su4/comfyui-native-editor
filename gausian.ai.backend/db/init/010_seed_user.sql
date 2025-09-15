INSERT INTO users (email, username, password_hash)
VALUES ('you@example.com','you', crypt('yourpassword', gen_salt('bf', 10)))
ON CONFLICT (email) DO NOTHING;