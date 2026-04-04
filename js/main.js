document.addEventListener('DOMContentLoaded', () => {
    // Mobile menu toggle
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.nav-links');

    if (hamburger && navLinks) {
        hamburger.addEventListener('click', () => {
            navLinks.classList.toggle('active');
            const icon = hamburger.querySelector('i');
            if (navLinks.classList.contains('active')) {
                icon.classList.remove('fa-bars');
                icon.classList.add('fa-times');
            } else {
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            }
        });
    }

    // Close mobile menu when clicking a link
    const links = document.querySelectorAll('.nav-links a');
    links.forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                navLinks.classList.remove('active');
                const icon = hamburger.querySelector('i');
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            }
        });
    });

    // Intersection Observer for scroll animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('appear');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('.fade-in').forEach(element => {
        observer.observe(element);
    });

    // Navbar scroll effect
    const navbar = document.querySelector('.navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.4)';
        } else {
            navbar.style.boxShadow = 'none';
        }
    });

    // Mouse interactive glow
    const cursorGlow = document.querySelector('.cursor-glow');
    if (cursorGlow) {
        document.addEventListener('mousemove', (e) => {
            requestAnimationFrame(() => {
                cursorGlow.style.left = `${e.clientX}px`;
                cursorGlow.style.top = `${e.clientY}px`;
            });
        });
    }

    // Interactive text glow
    const glowTexts = document.querySelectorAll('h1, h2, h3, .price, .badge');
    glowTexts.forEach(el => {
        el.style.setProperty('--mouse-x', '50%');
        el.style.setProperty('--mouse-y', '50%');

        el.addEventListener('mousemove', e => {
            const rect = el.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            el.style.setProperty('--mouse-x', `${x}px`);
            el.style.setProperty('--mouse-y', `${y}px`);
            el.classList.add('glow-active');
        });

        el.addEventListener('mouseleave', () => {
            el.classList.remove('glow-active');
            el.style.setProperty('--mouse-x', '50%');
            el.style.setProperty('--mouse-y', '50%');
        });
    });

    // Modal Preview Logic for Service Cards
    const serviceCards = document.querySelectorAll('.service-card');
    const modal = document.getElementById('previewModal');
    const modalImg = document.getElementById('previewImage');
    const closeBtn = document.querySelector('.close-modal');

    if (modal && modalImg && closeBtn) {
        serviceCards.forEach(card => {
            card.addEventListener('click', (e) => {
                // Ignore clicks if somehow an actual link is clicked inside the card
                if (e.target.tagName !== 'A') {
                    const imgSrc = card.getAttribute('data-preview');
                    if (imgSrc) {
                        modalImg.src = imgSrc;
                        modal.classList.add('show');
                        document.body.style.overflow = 'hidden'; // Prevent scrolling in background
                    }
                }
            });
        });

        const closeModal = () => {
            modal.classList.remove('show');
            document.body.style.overflow = 'auto'; // Restore scrolling
            setTimeout(() => { modalImg.src = ''; }, 300); // Clear image after transition
        };

        closeBtn.addEventListener('click', closeModal);

        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });
        
        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('show')) {
                closeModal();
            }
        });
    }
});

// ================================================================
// PRICING TOGGLE & STRIPE CHECKOUT
// ================================================================
(async function initPricing() {
    const toggle = document.getElementById('billing-toggle');
    const labelMonthly = document.getElementById('label-monthly');
    const labelAnnual = document.getElementById('label-annual');
    const priceDisplays = document.querySelectorAll('.pricing-card .price');
    const planBtns = document.querySelectorAll('.plan-btn');

    if (!toggle || planBtns.length === 0) return;

    // Fetch price IDs from server (not secret — just plan slugs)
    let prices = {};
    try {
        const res = await fetch('/api/prices');
        prices = await res.json();
    } catch (e) {
        console.warn('Could not load price IDs from server:', e.message);
    }

    let isAnnual = false;

    function updateToggleUI() {
        // Label active states
        if (isAnnual) {
            labelMonthly.classList.remove('active');
            labelAnnual.classList.add('active');
        } else {
            labelMonthly.classList.add('active');
            labelAnnual.classList.remove('active');
        }

        // Swap price display HTML on each card
        priceDisplays.forEach(el => {
            const html = isAnnual ? el.dataset.annualHtml : el.dataset.monthlyHtml;
            if (html) el.innerHTML = html;
        });
    }

    toggle.addEventListener('change', function () {
        isAnnual = this.checked;
        updateToggleUI();
    });

    // Wire checkout buttons
    planBtns.forEach(btn => {
        btn.addEventListener('click', async function () {
            const plan = this.dataset.plan; // 'solo' | 'growth' | 'team'
            const billingCycle = isAnnual ? 'annual' : 'monthly';
            const priceId = prices[plan] && prices[plan][billingCycle];

            if (!priceId) {
                alert('Šiuo metu mokėjimai dar nesukonfigūruoti. Susisiekite su mumis tiesiogiai.');
                return;
            }

            const originalText = this.textContent;
            this.textContent = 'Kraunama...';
            this.disabled = true;

            try {
                const res = await fetch('/create-checkout-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ priceId }),
                });
                const data = await res.json();

                if (data.url) {
                    window.location.href = data.url;
                } else {
                    throw new Error(data.error || 'Nežinoma klaida');
                }
            } catch (e) {
                console.error('Checkout error:', e);
                alert('Nepavyko atidaryti mokėjimo. Bandykite dar kartą arba susisiekite su mumis.');
                this.textContent = originalText;
                this.disabled = false;
            }
        });
    });
}());

// ================================================================
// ONBOARDING WIZARD FORM
// ================================================================
(function initWizard() {
    const form = document.getElementById('onboarding-form');
    if (!form) return;

    const steps = Array.from(form.querySelectorAll('.wizard-step'));
    const progressSteps = Array.from(form.querySelectorAll('.progress-step'));
    const progressBar = document.getElementById('progress-bar');
    const btnPrev = form.querySelector('.wizard-prev');
    const btnNext = form.querySelector('.wizard-next');
    const btnSubmit = form.querySelector('.wizard-submit');
    const successEl = document.getElementById('form-success');

    // Track toggle choices
    const choices = {};
    let currentStep = 0;

    // Total visible steps (used for progress calculation)
    function getVisibleSteps() {
        return steps.filter((step, i) => {
            const cond = step.dataset.conditional;
            if (!cond) return true;
            // If the conditional field has been answered "no", skip
            if (choices[cond] === false) return false;
            return true;
        });
    }

    function getVisibleStepIndices() {
        const indices = [];
        steps.forEach((step, i) => {
            const cond = step.dataset.conditional;
            if (!cond || choices[cond] !== false) {
                indices.push(i);
            }
        });
        return indices;
    }

    function showStep(index) {
        steps.forEach((s, i) => {
            s.classList.toggle('active', i === index);
        });

        // Update progress indicators
        const visibleIndices = getVisibleStepIndices();
        const currentVisiblePos = visibleIndices.indexOf(index);
        const totalVisible = visibleIndices.length;

        progressSteps.forEach((ps, i) => {
            const stepNum = parseInt(ps.dataset.step) - 1;
            ps.classList.remove('active', 'completed');
            // Hide steps that are skipped
            if (visibleIndices.indexOf(stepNum) === -1) {
                ps.style.display = 'none';
            } else {
                ps.style.display = 'flex';
                const visPos = visibleIndices.indexOf(stepNum);
                if (visPos < currentVisiblePos) {
                    ps.classList.add('completed');
                } else if (visPos === currentVisiblePos) {
                    ps.classList.add('active');
                }
            }
        });

        // Progress bar width
        const pct = totalVisible > 1 ? (currentVisiblePos / (totalVisible - 1)) * 100 : 0;
        progressBar.style.width = pct + '%';

        // Show/hide nav buttons
        btnPrev.style.display = currentVisiblePos > 0 ? 'inline-flex' : 'none';

        const isLast = currentVisiblePos === totalVisible - 1;
        btnNext.style.display = isLast ? 'none' : 'inline-flex';
        btnSubmit.style.display = isLast ? 'inline-flex' : 'none';

        // Scroll form into view
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function getNextVisibleStep(from, direction) {
        const visibleIndices = getVisibleStepIndices();
        const currentVisiblePos = visibleIndices.indexOf(from);
        const nextPos = currentVisiblePos + direction;
        if (nextPos < 0 || nextPos >= visibleIndices.length) return -1;
        return visibleIndices[nextPos];
    }

    // Validation
    function validateStep(index) {
        const step = steps[index];
        const requiredInputs = step.querySelectorAll('input[required], textarea[required]');
        let valid = true;

        requiredInputs.forEach(input => {
            const group = input.closest('.form-group');
            // Only validate visible fields
            const condParent = input.closest('.conditional-fields');
            if (condParent && condParent.style.display === 'none') return;

            if (!input.value.trim()) {
                group.classList.add('has-error');
                valid = false;
            } else {
                group.classList.remove('has-error');
            }

            // Email validation
            if (input.type === 'email' && input.value.trim()) {
                const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRe.test(input.value.trim())) {
                    group.classList.add('has-error');
                    valid = false;
                }
            }
        });

        return valid;
    }

    // Toggle choice buttons (Yes/No)
    form.addEventListener('click', function(e) {
        const btn = e.target.closest('.choice-btn');
        if (!btn) return;

        const toggle = btn.closest('.toggle-choice');
        const field = toggle.dataset.field;
        const value = btn.dataset.value;

        // Update active state
        toggle.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Store choice
        choices[field] = value === 'yes';

        // Show/hide conditional fields
        const conditionals = form.querySelectorAll(`.conditional-fields[data-show-when="${field}=yes"]`);
        conditionals.forEach(cf => {
            if (value === 'yes') {
                cf.style.display = 'block';
                cf.classList.add('visible');
            } else {
                cf.style.display = 'none';
                cf.classList.remove('visible');
            }
        });

        // For conditional steps (4, 5), if "Ne" is chosen, update nav
        if (steps[currentStep].dataset.conditional === field) {
            showStep(currentStep);
        }
    });

    // Clear error on input
    form.addEventListener('input', function(e) {
        const group = e.target.closest('.form-group');
        if (group) group.classList.remove('has-error');
    });

    // Next button
    btnNext.addEventListener('click', function() {
        if (!validateStep(currentStep)) return;

        // For conditional steps, if no choice made yet on the toggle, check
        const step = steps[currentStep];
        const cond = step.dataset.conditional;
        if (cond && choices[cond] === undefined) {
            // They haven't chosen yet — treat as "needs answer"
            return;
        }

        // If on a conditional step and user chose "Ne", skip sub-fields
        const next = getNextVisibleStep(currentStep, 1);
        if (next === -1) return;
        currentStep = next;
        showStep(currentStep);
    });

    // Prev button
    btnPrev.addEventListener('click', function() {
        const prev = getNextVisibleStep(currentStep, -1);
        if (prev === -1) return;
        currentStep = prev;
        showStep(currentStep);
    });

    // Submit
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        if (!validateStep(currentStep)) return;

        // Collect data
        const data = {
            salon_name: form.querySelector('#salon_name').value.trim(),
            phone: form.querySelector('#phone').value.trim(),
            email: form.querySelector('#email').value.trim(),
            instagram: form.querySelector('#instagram').value.trim(),
            address: form.querySelector('#address').value.trim(),
            services_prices: form.querySelector('#services_prices').value.trim(),
            working_hours: form.querySelector('#working_hours').value.trim(),
            has_logo: choices.has_logo === true,
            preferred_colors: form.querySelector('#preferred_colors').value.trim(),
            design_style: (function() {
                const checked = form.querySelector('input[name="design_style"]:checked');
                return checked ? checked.value : '';
            })(),
            wants_booking: choices.wants_booking === true,
            service_durations: form.querySelector('#service_durations') ? form.querySelector('#service_durations').value.trim() : '',
            break_times: form.querySelector('#break_times') ? form.querySelector('#break_times').value.trim() : '',
            off_days: (function() {
                const checked = form.querySelectorAll('input[name="off_days"]:checked');
                return Array.from(checked).map(cb => cb.value);
            })(),
            wants_seo: choices.wants_seo === true,
            seo_city: form.querySelector('#seo_city') ? form.querySelector('#seo_city').value.trim() : '',
            seo_services: form.querySelector('#seo_services') ? form.querySelector('#seo_services').value.trim() : '',
            notes: form.querySelector('#notes') ? form.querySelector('#notes').value.trim() : ''
        };

        // Disable submit
        btnSubmit.disabled = true;
        btnSubmit.textContent = 'Siunčiama...';

        try {
            const res = await fetch('https://velora-ops.onrender.com/webhook/onboarding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!res.ok) {
                throw new Error('Serverio klaida: ' + res.status);
            }

            // Show success
            form.style.display = 'none';
            successEl.style.display = 'block';
        } catch (err) {
            console.error('Onboarding submit error:', err);
            alert('Nepavyko išsiųsti formos. Bandykite dar kartą arba susisiekite su mumis el. paštu info@velorastudio.lt');
            btnSubmit.disabled = false;
            btnSubmit.textContent = 'Pateikti informaciją';
        }
    });

    // Initialize
    showStep(0);
}());
