# 🎮 BLUFF FACT! — Multiplayer Game Show

> **Submission for the $1,000 Multiplayer Game Challenge**  
> A real-time, party game where friends, classmates, and family join from their own devices to invent convincing lies for bizarre real facts and vote to spot the truth!

---

## 🚀 Quick Start (Running Locally)

The server is currently running live on your computer at:
👉 **[http://localhost:3000](http://localhost:3000)**

### How to Test with 2 Players on Your Computer:
1. Open your browser and go to: **`http://localhost:3000`**
   - Pick an avatar (e.g. 🦁 Lion), enter nickname **"HostAlice"**, and click **CREATE ROOM**.
   - You'll see a unique 4-letter room code (e.g., `KRN8`) and a "Copy Join Link" button.
2. Open a **second tab in Incognito / Private Window** (or a second browser window):
   - Go to **`http://localhost:3000`** (or paste the copied join link).
   - Pick an avatar (e.g. 🦊 Fox), enter nickname **"PlayerBob"**, enter the 4-letter code, and click **JOIN ROOM**.
3. In Tab 1 (Host), you will see PlayerBob appear instantly! The **START GAME 🚀** button will turn green and become clickable.
4. Click **START GAME** and enjoy playing!

---

## 🎯 Gameplay Rules & Scoring

1. **Phase 1: The Bluff (35s)**:
   - A bizarre, real-world fact appears with a missing blank (e.g. *"In Switzerland, it is illegal under animal rights law to own just one ________ because they get lonely."*).
   - Every player types their most convincing fake answer on their phone/tab.
   - *Smart Truth Detection*: If you accidentally type the real answer, the game warns you immediately so you don't spoil it!
2. **Phase 2: The Vote (25s)**:
   - All bluffs + the real truth are shuffled and displayed as buttons.
   - Players vote for what they think is the actual fact. (You cannot vote for your own lie!)
3. **Phase 3: The Reveal**:
   - Dramatic game-show reveal highlights who got tricked by whose bluff, followed by the triumphant truth!
   - **Scoring**:
     - **+1,000 pts**: Spotting the real truth.
     - **+500 pts**: Each player you fooled into voting for your bluff.
     - **+Speed Bonus**: Up to +250 extra pts for rapid correct guesses.
     - *Round 3 is Double Points!*
4. **Phase 4: Grand Podium**:
   - 1st, 2nd, and 3rd place podium with confetti and audio fanfare.
   - Host can click "Play Again" to restart with fresh questions!

---

## 🌐 Public Deployment (For the Challenge Submission Link)

You can share this game publicly on **Render**, **Railway**, **Fly.io**, or **Netlify**:

### Option 1: Render / Railway (1-Click, Free & Automatic WebSockets)
1. Push this folder to a GitHub repository.
2. Go to [render.com](https://render.com) or [railway.app](https://railway.app) (free tier).
3. Connect your GitHub repository:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
4. Render gives you an instant `https://your-game.onrender.com` public URL to submit!

### Option 2: Local Network Play (Same Wi-Fi)
- Find your local IP address (`ipconfig` in cmd, e.g. `192.168.1.X`).
- Anyone connected to your home or campus Wi-Fi can open `http://192.168.1.X:3000` on their phone to play together!
