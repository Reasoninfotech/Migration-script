document.addEventListener("DOMContentLoaded", () => {
    // DOM Elements
    const form = document.getElementById("migration-form");
    const sourceShopInput = document.getElementById("source-shop");
    const sourceTokenInput = document.getElementById("source-token");
    const targetShopInput = document.getElementById("target-shop");
    const targetTokenInput = document.getElementById("target-token");
    
    const btnSubmit = document.getElementById("btn-submit");
    const btnClear = document.getElementById("btn-clear");
    const btnCopy = document.getElementById("btn-copy");
    
    const statusPill = document.getElementById("global-status-pill");
    const statusText = document.getElementById("status-text");
    const terminalConnStatus = document.getElementById("terminal-conn-status");
    const terminalBody = document.getElementById("terminal-body");

    let eventSource = null;

    // 1. Password Visibility Toggle
    document.querySelectorAll(".btn-toggle-pass").forEach(btn => {
        btn.addEventListener("click", () => {
            const wrapper = btn.closest(".password-wrapper");
            const input = wrapper.querySelector("input");
            if (input.type === "password") {
                input.type = "text";
                btn.innerHTML = `<i data-lucide="eye-off"></i>`;
            } else {
                input.type = "password";
                btn.innerHTML = `<i data-lucide="eye"></i>`;
            }
            lucide.createIcons();
        });
    });

    // 2. Load Saved Credentials from LocalStorage
    const loadCredentials = () => {
        sourceShopInput.value = localStorage.getItem("mig_source_shop") || "";
        sourceTokenInput.value = localStorage.getItem("mig_source_token") || "";
        targetShopInput.value = localStorage.getItem("mig_target_shop") || "";
        targetTokenInput.value = localStorage.getItem("mig_target_token") || "";
    };

    // Save Credentials to LocalStorage
    const saveCredentials = () => {
        localStorage.setItem("mig_source_shop", sourceShopInput.value.trim());
        localStorage.setItem("mig_source_token", sourceTokenInput.value.trim());
        localStorage.setItem("mig_target_shop", targetShopInput.value.trim());
        localStorage.setItem("mig_target_token", targetTokenInput.value.trim());
    };

    loadCredentials();

    // 3. Helper to update Status HUD
    const updateStatus = (state, text) => {
        // Clear old classes
        statusPill.className = "connection-status-pill";
        
        if (state === "idle") {
            statusPill.classList.add("status-idle");
            statusText.textContent = text || "Idle";
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = `<i data-lucide="play-circle"></i> Run Store Migration`;
        } else if (state === "running") {
            statusPill.classList.add("status-running");
            statusText.textContent = text || "Running Migration...";
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = `<i data-lucide="loader" class="animate-spin"></i> Executing Scripts...`;
        } else if (state === "completed") {
            statusPill.classList.add("status-completed");
            statusText.textContent = text || "Completed Successfully";
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = `<i data-lucide="play-circle"></i> Run Store Migration`;
        } else if (state === "failed") {
            statusPill.classList.add("status-failed");
            statusText.textContent = text || "Migration Failed";
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = `<i data-lucide="play-circle"></i> Run Store Migration`;
        }
        lucide.createIcons();
    };

    // 4. Log Parsing & Dynamic Color Theme Styles
    const appendLogLine = (text, customClass = "") => {
        if (!text && text !== "") return;
        
        const lineDiv = document.createElement("div");
        lineDiv.className = "terminal-line";
        
        // Auto-assign formatting classes based on console log words
        if (customClass) {
            lineDiv.classList.add(customClass);
        } else if (text.includes("❌") || text.toUpperCase().includes("FAIL") || text.toUpperCase().includes("ERROR")) {
            lineDiv.classList.add("log-error");
        } else if (text.includes("🎉") || text.includes("🚀") || text.toUpperCase().includes("COMPLETE") || text.toUpperCase().includes("SUCCESS")) {
            lineDiv.classList.add("log-success");
        } else if (text.includes("===") || text.includes("STARTING") || text.includes("MIGRATION")) {
            lineDiv.classList.add("log-info");
        } else if (text.match(/Step \d+/i)) {
            lineDiv.classList.add("log-accent");
        }

        lineDiv.textContent = text;
        terminalBody.appendChild(lineDiv);
        
        // Auto Scroll to bottom
        terminalBody.scrollTop = terminalBody.scrollHeight;
    };

    // 5. Submit Handler (Saves Configuration & Starts Streaming)
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const sourceShop = sourceShopInput.value.trim();
        const sourceToken = sourceTokenInput.value.trim();
        const targetShop = targetShopInput.value.trim();
        const targetToken = targetTokenInput.value.trim();

        // Save locally first
        saveCredentials();

        // Clear terminal output for fresh start
        terminalBody.innerHTML = "";
        appendLogLine("⏳ Connecting to host server to update configuration file...", "system-msg");

        updateStatus("running", "Configuring...");

        try {
            // Save settings via PHP endpoint
            const response = await fetch("save-config.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sourceShop, sourceToken, targetShop, targetToken })
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || "Failed to update configuration on server.");
            }

            appendLogLine("✅ Configuration saved! Initiating real-time script process...", "log-success");

            // Setup real-time SSE listener
            startMigrationStream();

        } catch (error) {
            appendLogLine(`❌ CONFIG SAVE ERROR: ${error.message}`, "log-error");
            updateStatus("failed", "Failed Config");
        }
    });

    // 6. Connect Server-Sent Events (SSE) Stream
    const startMigrationStream = () => {
        if (eventSource) {
            eventSource.close();
        }

        terminalConnStatus.textContent = "Connecting...";
        terminalConnStatus.className = "terminal-connection loading";

        // Listen to run-migration.php SSE output stream
        eventSource = new EventSource("run-migration.php");

        // Event: Log lines
        eventSource.addEventListener("log", (e) => {
            const data = JSON.parse(e.data);
            appendLogLine(data.text);
        });

        // Event: Running status updates
        eventSource.addEventListener("status", (e) => {
            const data = JSON.parse(e.data);
            terminalConnStatus.textContent = "Connected";
            terminalConnStatus.className = "terminal-connection connected";

            if (data.state === "running") {
                updateStatus("running", "Migrating...");
            } else if (data.state === "completed") {
                appendLogLine(`\n🏆 ${data.message}`, "log-success");
                updateStatus("completed");
                closeStream();
            } else if (data.state === "failed") {
                appendLogLine(`\n❌ ${data.message}`, "log-error");
                updateStatus("failed");
                closeStream();
            }
        });

        // Event: SSE generic error handler
        eventSource.onerror = (err) => {
            appendLogLine("\n📡 Real-time stream closed by server.", "system-msg");
            terminalConnStatus.textContent = "Disconnected";
            terminalConnStatus.className = "terminal-connection";
            
            // Re-verify if migration is actually completed or stalled
            if (statusText.textContent === "Migrating...") {
                updateStatus("failed", "Interrupted");
            }
            closeStream();
        };
    };

    const closeStream = () => {
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
    };

    // 7. Clear Terminal Screen
    btnClear.addEventListener("click", () => {
        terminalBody.innerHTML = "";
        appendLogLine("🧹 Terminal logs cleared.", "system-msg");
    });

    // 7b. Reset Migration Cache (Custom Confirm Modal)
    const btnResetCache = document.getElementById("btn-reset-cache");
    const confirmCacheModal = document.getElementById("confirm-cache-modal");
    const btnConfirmCancel = document.getElementById("btn-confirm-cancel");
    const btnConfirmReset = document.getElementById("btn-confirm-reset");

    if (btnResetCache && confirmCacheModal) {
        // Open Modal
        btnResetCache.addEventListener("click", () => {
            confirmCacheModal.classList.add("open");
        });

        // Close Modal on Cancel
        btnConfirmCancel.addEventListener("click", () => {
            confirmCacheModal.classList.remove("open");
        });

        // Close Modal on clicking outside the card
        confirmCacheModal.addEventListener("click", (e) => {
            if (e.target === confirmCacheModal) {
                confirmCacheModal.classList.remove("open");
            }
        });

        // Perform Reset Cache on Confirm
        btnConfirmReset.addEventListener("click", async () => {
            confirmCacheModal.classList.remove("open");
            try {
                const res = await fetch("reset-cache.php", { method: "POST" });
                const result = await res.json();
                
                if (res.ok && result.success) {
                    appendLogLine("🧹 Migration memory cache cleared! Next migration will run completely from scratch.", "system-msg");
                    
                    const originalHTML = btnResetCache.innerHTML;
                    btnResetCache.innerHTML = `<i data-lucide="check" style="color: var(--color-success)"></i> Cache Cleared`;
                    lucide.createIcons();
                    
                    setTimeout(() => {
                        btnResetCache.innerHTML = originalHTML;
                        lucide.createIcons();
                    }, 2000);
                } else {
                    throw new Error(result.error || "Failed to delete file.");
                }
            } catch (err) {
                appendLogLine(`❌ RESET CACHE ERROR: ${err.message}`, "log-error");
                alert("Error clearing cache: " + err.message);
            }
        });
    }

    // 8. Copy Terminal Output
    btnCopy.addEventListener("click", () => {
        const textToCopy = Array.from(terminalBody.querySelectorAll(".terminal-line"))
            .map(el => el.textContent)
            .join("\n");
            
        navigator.clipboard.writeText(textToCopy)
            .then(() => {
                const originalHTML = btnCopy.innerHTML;
                btnCopy.innerHTML = `<i data-lucide="check" style="color: var(--color-success)"></i>`;
                lucide.createIcons();
                setTimeout(() => {
                    btnCopy.innerHTML = originalHTML;
                    lucide.createIcons();
                }, 1500);
            })
            .catch(err => {
                alert("Failed to copy text: " + err);
            });
    });

    // 9. Setup Guide Slide-out Drawer Control
    const btnToggleGuide = document.getElementById("btn-toggle-guide");
    const btnCloseGuide = document.getElementById("btn-close-guide");
    const guideDrawer = document.getElementById("guide-drawer");
    const guideBackdrop = document.getElementById("guide-backdrop");

    const openGuide = () => {
        guideDrawer.classList.add("open");
        guideBackdrop.classList.add("open");
    };

    const closeGuide = () => {
        guideDrawer.classList.remove("open");
        guideBackdrop.classList.remove("open");
    };

    if (btnToggleGuide && btnCloseGuide && guideDrawer && guideBackdrop) {
        btnToggleGuide.addEventListener("click", openGuide);
        btnCloseGuide.addEventListener("click", closeGuide);
        guideBackdrop.addEventListener("click", closeGuide);
    }

    // 10. Image Lightbox Pop-up Logic
    const lightboxModal = document.getElementById("lightbox-modal");
    const lightboxImg = document.getElementById("lightbox-img");
    const btnCloseLightbox = document.getElementById("btn-close-lightbox");

    document.querySelectorAll(".step-screenshot").forEach(img => {
        img.addEventListener("click", () => {
            lightboxImg.src = img.src;
            lightboxModal.classList.add("open");
        });
    });

    const closeLightbox = () => {
        lightboxModal.classList.remove("open");
        // Clear src after fade out to avoid a quick flash on next image click
        setTimeout(() => {
            lightboxImg.src = "";
        }, 400);
    };

    if (btnCloseLightbox && lightboxModal) {
        btnCloseLightbox.addEventListener("click", closeLightbox);
        
        // Close when clicking on backdrop
        lightboxModal.addEventListener("click", (e) => {
            if (e.target === lightboxModal) {
                closeLightbox();
            }
        });

        // Close on Escape key press
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && lightboxModal.classList.contains("open")) {
                closeLightbox();
            }
        });
    }
});
