const app = document.getElementById("app");
const apiBase = "/api";
const faceModelUrl = "https://justadudewhohacks.github.io/face-api.js/models";
let customers = [];
let loggedInUser = null;
let currentCustomer = null;
let recognitionInterval = null;
let recognitionStream = null;
let registerStream = null;
let faceModelsLoaded = false;
let toastTimer = null;

function showToast(message) {
  clearTimeout(toastTimer);
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toastTimer = setTimeout(() => toast.remove(), 3200);
}

function createElement(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstChild;
}

async function api(path, options = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Server error");
  }
  return data;
}

async function loadFaceModels() {
  if (faceModelsLoaded) return;
  try {
    showToast("Loading face models...");
    await faceapi.nets.tinyFaceDetector.loadFromUri(faceModelUrl);
    await faceapi.nets.faceLandmark68Net.loadFromUri(faceModelUrl);
    await faceapi.nets.faceRecognitionNet.loadFromUri(faceModelUrl);
    faceModelsLoaded = true;
    showToast("Face models loaded");
  } catch (error) {
    console.error(error);
    showToast("Face model load failed, camera features may not work.");
  }
}

function setPage(content) {
  app.innerHTML = "";
  app.appendChild(content);
}

async function fetchSession() {
  try {
    const data = await api("/session", { method: "GET" });
    loggedInUser = data.user;
  } catch (error) {
    loggedInUser = null;
  }
}

async function renderLogin() {
  const card = createElement(`
    <div id="login-card" class="card">
      <div class="section">
        <div class="hero">
          <div>
            <h1>Smart Khata</h1>
            <p>Admin login karein aur apna khata system start karein.</p>
          </div>
        </div>
        <form id="login-form">
          <div class="form-row">
            <label>Username</label>
            <input type="text" id="username" value="admin" required />
          </div>
          <div class="form-row">
            <label>Password</label>
            <input type="password" id="password" value="admin" required />
          </div>
          <button type="submit" class="button">Login</button>
        </form>
      </div>
    </div>
  `);

  setPage(card);
  const form = document.getElementById("login-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const username = document.getElementById("username").value.trim();
      const password = document.getElementById("password").value;
      await api("/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      loggedInUser = username;
      await renderDashboard();
    } catch (error) {
      showToast(error.message);
    }
  });
}

function formatCurrency(value) {
  return `Rs. ${Number(value || 0).toLocaleString()}`;
}

function createCustomerRow(customer) {
  const status = Number(customer.balance) > 0 ? "Baqaya" : Number(customer.balance) < 0 ? "Advance" : "Clear";
  const colorClass = Number(customer.balance) > 0 ? "text-destructive" : "text-success";
  const item = createElement(`
    <div class="list-item" data-id="${customer.id}">
      <div style="display:flex;align-items:center;gap:30px;">
        <div class="avatar">${customer.name.slice(0, 2).toUpperCase()}</div>
        <div>
          <div><strong>${customer.name}</strong></div>
          <div class="small-text">${customer.phone || "No phone"}</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div><strong>${formatCurrency(customer.balance)}</strong></div>
        <div style="font-weight:bold;">${status}</div>
      </div>
    </div>
  `);
  item.addEventListener("click", () => showCustomerDetail(customer));
  return item;
}

async function loadCustomers() {
  const data = await api("/customers", { method: "GET" });
  customers = data;
  return customers;
}

function calculateStats() {
  const total = customers.length;
  const duesCount = customers.filter((c) => Number(c.balance) > 0).length;
  const totalDue = customers.reduce((sum, c) => sum + Number(c.balance), 0);
  return { total, duesCount, totalDue };
}

function stopStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}

function closeModal() {
  const existing = document.querySelector(".modal");
  if (existing) existing.remove();
  stopStream(registerStream);
  registerStream = null;
}

async function openAddCustomerModal() {
  await loadFaceModels();
  const modal = createElement(`
    <div class="modal">
      <div class="modal-card">
        <div class="modal-header">
          <div>
            <strong>+ Naya Customer</strong>
          </div>
          <button class="close-button" id="close-modal">✕</button>
        </div>
        <div class="modal-body">
          <form id="customer-form">
            <div class="form-row">
              <label>Naam</label>
              <input type="text" id="customer-name" required />
            </div>
            <div class="form-row">
              <label>Phone</label>
              <input type="text" id="customer-phone" />
            </div>
            <div class="form-row">
              <label>Address</label>
              <textarea id="customer-address"></textarea>
            </div>
            <div class="form-row">
              <label>Photo / Face Capture</label>
              <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                <button type="button" class="button small" id="open-camera">Open Camera</button>
                <button type="button" class="button outline small" id="capture-photo">Capture Photo</button>
              </div>
            </div>
            <div class="form-row">
              <div class="video-card hidden" id="register-video-card">
                <video id="register-video" autoplay muted playsinline></video>
              </div>
            </div>
            <div class="form-row">
              <button type="submit" class="button">Save Customer</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `);

  document.body.appendChild(modal);
  document.getElementById("close-modal").onclick = closeModal;

  const videoCard = document.getElementById("register-video-card");
  const registerVideo = document.getElementById("register-video");
  let capturedPhotoData = null;
  let currentDescriptor = null;

  async function startRegisterCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      registerStream = stream;
      registerVideo.srcObject = stream;
      videoCard.classList.remove("hidden");
      await registerVideo.play();
      showToast("Camera ready for customer photo");
    } catch (error) {
      console.error(error);
      showToast("Camera not available. Use normal save.");
    }
  }

  async function captureCustomerPhoto() {
    if (!registerVideo || !registerVideo.videoWidth) {
      showToast("Camera not ready yet");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = registerVideo.videoWidth;
    canvas.height = registerVideo.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(registerVideo, 0, 0, canvas.width, canvas.height);
    capturedPhotoData = canvas.toDataURL("image/jpeg", 0.9);
    showToast("Photo captured");

    if (faceModelsLoaded) {
      const detection = await faceapi
        .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (detection) {
        currentDescriptor = Array.from(detection.descriptor);
        showToast("Face descriptor ready");
      } else {
        showToast("Chehra detect nahi hua. Dobara try karein.");
      }
    }

    stopStream(registerStream);
    videoCard.classList.add("hidden");

    // Scroll to the save button after capturing photo
    const saveButton = document.querySelector("#customer-form button[type='submit']");
    if (saveButton) {
      saveButton.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  document.getElementById("open-camera").onclick = startRegisterCamera;
  document.getElementById("capture-photo").onclick = captureCustomerPhoto;

  document.getElementById("customer-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("customer-name").value.trim();
    const phone = document.getElementById("customer-phone").value.trim();
    const address = document.getElementById("customer-address").value.trim();

    if (!name) {
      showToast("Naam dalen");
      return;
    }

    try {
      await api("/customers", {
        method: "POST",
        body: JSON.stringify({
          name,
          phone: phone || null,
          address: address || null,
          photo_data: capturedPhotoData,
          face_descriptor: currentDescriptor,
        }),
      });
      showToast("Customer save ho gaya");
      closeModal();
      await renderDashboard();
    } catch (error) {
      showToast(error.message);
    }
  });
}

function renderCustomerList() {
  const list = document.createElement("div");
  list.className = "list-card";
  if (customers.length === 0) {
    list.innerHTML = `<div class="list-item"><div><strong>Koi customer nahi hai</strong><div class="small-text">Naya customer add karne ke liye upar button use karein.</div></div></div>`;
    return list;
  }
  customers.forEach((customer) => list.appendChild(createCustomerRow(customer)));
  return list;
}

function renderStatsPanel() {
  const stats = calculateStats();
  const panel = createElement(`
    <div class="grid grid-cols-3" style="margin-bottom:16px;">
      <div class="card section stat"><div style="font-weight:bold;font-size:30px;">Kul Customers</div><strong>${stats.total}</strong></div>
      <div class="card section stat"><div style="font-weight:bold;font-size:30px;">Baqaya Wale</div><strong>${stats.duesCount}</strong></div>
      <div class="card section stat"><div style="font-weight:bold;font-size:30px;">Kul Baqaya</div><strong>${formatCurrency(stats.totalDue)}</strong></div>
    </div>
  `);
  return panel;
}

async function renderDashboard() {
  try {
    await fetchSession();
    if (!loggedInUser) {
      return renderLogin();
    }
    await loadCustomers();

    const page = createElement(`
      <div class="page">
        <header class="header">
          <div class="logo" style="font-size: 35px; font-weight: 700;"><span>📒</span> SMART KHATA </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
            <button class="button small" id="toggle-camera">Chehra Pehchaan</button>
            <button class="button outline small" id="add-customer">+ Naya Customer</button>
            <button class="button secondary small" id="logout">Logout</button>
          </div>
        </header>
        <div class="hero card section">
          <h1>Khata management aasan banayein</h1>
       
         </div>
        <div id="dashboard-content"></div>
      </div>
    `);

    setPage(page);
    document.getElementById("logout").onclick = async () => {
      await api("/logout", { method: "POST" });
      loggedInUser = null;
      renderLogin();
    };
    document.getElementById("add-customer").onclick = openAddCustomerModal;
    document.getElementById("toggle-camera").onclick = toggleRecognition;

    const dashboardContent = document.getElementById("dashboard-content");
    dashboardContent.appendChild(renderStatsPanel());
   dashboardContent.appendChild(createElement(`<div class="card"><div class="section"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;"><strong style="font-size:30px;">Customers</strong><span class="small-text">Click customer to open detail screen</span></div></div></div>`));
    dashboardContent.appendChild(renderCustomerList());
  } catch (error) {
    console.error(error);
    renderLogin();
  }
}

async function toggleRecognition() {
  if (recognitionInterval) {
    stopRecognition();
    return;
  }
  await loadFaceModels();
  startRecognition();
}

function stopRecognition() {
  clearInterval(recognitionInterval);
  recognitionInterval = null;
  stopStream(recognitionStream);
  recognitionStream = null;
  const panel = document.getElementById("recognition-panel");
  if (panel) panel.remove();
}

async function startRecognition() {
  const dashboard = document.querySelector(".page");
  const panel = createElement(`
    <div class="panel" id="recognition-panel" style="margin-bottom:20px;">
      <div class="panel-header">
        <div><strong>Chehre ki Pehchan</strong><div class="small-text">Camera ko on karen aur customer dekhen.</div></div>
        <button class="button outline small" id="stop-recognition">Stop</button>
      </div>
      <div class="panel-body" style="display:grid;gap:14px;">
        <div class="video-card"><video id="recognition-video" autoplay muted playsinline></video></div>
        <div id="recognition-status" class="small-text">Loading camera...</div>
      </div>
    </div>
  `);
  const content = document.getElementById("dashboard-content");
  content.prepend(panel);
  document.getElementById("stop-recognition").onclick = stopRecognition;

  const video = document.getElementById("recognition-video");
  try {
    recognitionStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    video.srcObject = recognitionStream;
    await video.play();
    document.getElementById("recognition-status").textContent = "Camera ready. Chehra scan ho raha hai...";
  } catch (error) {
    console.error(error);
    document.getElementById("recognition-status").textContent = "Camera access nahi mila. Try again.";
    return;
  }
// app.js -> startRecognition function

  const knownFaces = customers
    .filter((c) => c.face_descriptor)
    .map((c) => ({
      id: c.id,
      name: c.name,
      descriptor: c.face_descriptor,
      balance: c.balance, // Yahan humne balance shamil kar diya hai
    }));
  if (!knownFaces.length) {
    document.getElementById("recognition-status").textContent = "Koi registered face abhi nahi hai.";
    return;
  }

  recognitionInterval = setInterval(async () => {
    const detection = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (!detection) return;
    const descriptor = detection.descriptor;
    let best = { score: 1, customer: null };
    knownFaces.forEach((face) => {
      const distance = faceapi.euclideanDistance(descriptor, face.descriptor);
      if (distance < best.score) {
        best = { score: distance, customer: face };
      }
    });
    if (best.customer && best.score < 0.55) {
      showRecognitionPopup(best.customer, best.score);
      document.getElementById("recognition-status").textContent = `✓ ${best.customer.name} pehchana gaya`;
      stopRecognition();
    }
  }, 1800);
}
// app.js

function showRecognitionPopup(customer, score) {
  const existing = document.querySelector(".popup");
  if (existing) existing.remove();

  // --- NAYI LOGIC SHURU ---

  // 1. Balance ko number format mein convert karein
  const balanceAmount = parseFloat(customer.balance);
  
  // 2. Comma ke saath behtar format mein dikhayein (e.g., 1,200.00)
  const formattedBalance = Math.abs(balanceAmount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  
  // 3. Tay karein ke "Baqaya" dikhana hai ya "Advance"
  let balanceHTML;
  if (balanceAmount >= 0) {
    // Agar balance 0 ya usse zyada hai (customer ne paise dene hain)
    balanceHTML = `<div class="small-text text-destructive" style="font-size: 1.1rem; font-weight: 600;">Kul Baqaya: ${formattedBalance}</div>`;
  } else {
    // Agar balance negative hai (customer ne advance diya hai)
    balanceHTML = `<div class="small-text text-success" style="font-size: 1.1rem; font-weight: 600;">Advance: ${formattedBalance}</div>`;
  }

  // --- NAYI LOGIC KHATAM ---


  const popup = createElement(`
    <div class="popup">
      <div class="popup-inner">
        <strong>Customer Pehchaana</strong>
        <div class="small-text" style="font-size: 1.25rem; color: var(--primary); margin-top: 8px; margin-bottom: 12px;">${customer.name}</div>
        
        <!-- YAHAN HUMNE DISTANCE KI JAGAH BALANCE DIKHAYA HAI -->
        ${balanceHTML}
        
        <div class="popup-actions">
          <button class="button small" id="view-detail">Khata Dekhein</button>
          <button class="button outline small" id="close-popup">Band</button>
        </div>
      </div>
    </div>
  `);

  document.body.appendChild(popup);
  
  document.getElementById("close-popup").onclick = () => popup.remove();
  
  document.getElementById("view-detail").onclick = () => {
    popup.remove();
    // Yeh line customer ka poora data dhoond kar detail page dikhati hai
    const customerData = customers.find((c) => c.id === customer.id);
    if (customerData) {
        stopRecognition(); // Face recognition ko rok dein
        renderCustomerDetail(customerData); // Customer detail page render karein
    }
  };
}


async function showCustomerDetail(customer) {
  currentCustomer = customer;
  const transactions = await api(`/customers/${customer.id}/transactions`, { method: "GET" });

  const detail = createElement(`
    <div class="page">
      <header class="header">
        <div class="logo"><span>📒</span> ${customer.name}</div>
        <div style="display:flex;gap:10px;">
          <button class="button danger small" id="delete-customer">Delete Customer</button>
          <button class="button outline small" id="back-dashboard">Wapas</button>
        </div>
      </header>
      <div class="card section" style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px;">
          <div>
            <strong>${customer.name}</strong>
            <div class="small-text">${customer.phone || "Phone nahi"}</div>
            <div class="small-text">${customer.address || "Address nahi"}</div>
          </div>
          <div style="text-align:right;">
            <div class="badge" style="font-size:30px;padding:12px 16px;font-weight:bold;background:linear-gradient(135deg, #fef3c7 0%, #fef08a 100%);color:#b45309;">${formatCurrency(customer.balance)}</div>
            <div style="font-weight:bold;font-size:30px;margin-top:8px;">Baqaya</div>
          </div>
        </div>
      </div>
      <div class="grid grid-cols-3" style="gap:20px; margin-bottom:20px;">
        <div class="card section" style="grid-column: span 2;">
          <div class="panel-header"><strong>Naya Transaction</strong></div>
          <div class="panel-body">
            <form id="transaction-form">
              <div class="form-row">
                <label>Amount</label>
                <input type="number" id="tx-amount" required min="1" />
              </div>
              <div class="form-row">
                <label>Description</label>
                <input type="text" id="tx-description" />
              </div>
              <div class="form-row" style="display:flex;gap:10px;flex-wrap:wrap;">
                <button type="button" class="button small" id="credit-btn">Udhaar (Credit)</button>
                <button type="button" class="button outline small" id="debit-btn">Wapsi (Debit)</button>
              </div>
              <input type="hidden" id="tx-type" value="credit" />
              <div class="form-row">
                <button type="submit" class="button">Transaction Add Karein</button>
              </div>
            </form>
          </div>
        </div>
        <div class="card section">
          <div class="panel-header"><strong>Transactions</strong></div>
          <div class="panel-body" id="transaction-list"></div>
        </div>
      </div>
    </div>
  `);

  setPage(detail);
  document.getElementById("back-dashboard").onclick = renderDashboard;
  document.getElementById("delete-customer").onclick = async () => {
    if (confirm("Kya aap sach mein is customer ko delete karna chahte hain?")) {
      try {
        await api(`/customers/${customer.id}`, { method: "DELETE" });
        showToast("Customer delete ho gaya");
        renderDashboard();
      } catch (error) {
        showToast(error.message);
      }
    }
  };
  const txTypeEl = document.getElementById("tx-type");
  document.getElementById("credit-btn").onclick = () => {
    txTypeEl.value = "credit";
    showToast("Credit set");
  };
  document.getElementById("debit-btn").onclick = () => {
    txTypeEl.value = "debit";
    showToast("Debit set");
  };

  const txList = document.getElementById("transaction-list");
  if (transactions.length === 0) {
    txList.innerHTML = `<div class="small-text">Koi record nahi hai</div>`;
  } else {
    txList.innerHTML = transactions
      .map(
        (tx) => `
          <div class="list-item" style="border:none;">
            <div>
              <strong>${tx.description || (tx.type === "credit" ? "Udhaar" : "Wapsi")}</strong>
              <div class="small-text">${new Date(tx.created_at).toLocaleString()}</div>
            </div>
            <div>${tx.type === "credit" ? "+" : "-"} ${formatCurrency(tx.amount)}</div>
          </div>
        `
      )
      .join("");
  }

  document.getElementById("transaction-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const amount = document.getElementById("tx-amount").value;
    const description = document.getElementById("tx-description").value.trim();
    const type = txTypeEl.value;
    try {
      await api(`/customers/${customer.id}/transactions`, {
        method: "POST",
        body: JSON.stringify({ type, amount, description }),
      });
      showToast("Transaction added");
      await renderDashboard();
    } catch (error) {
      showToast(error.message);
    }
  });
}

(async function init() {
  try {
    await fetchSession();
    if (loggedInUser) {
      await renderDashboard();
    } else {
      await renderLogin();
    }
  } catch (error) {
    await renderLogin();
  }
})();
