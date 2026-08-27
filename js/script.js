document.addEventListener('DOMContentLoaded', function() {
    const root = document.documentElement;
    const themeToggle = document.getElementById('themeToggle');
    
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const savedTheme = localStorage.getItem('theme') || (prefersDark ? 'dark' : 'light');
    root.setAttribute('data-theme', savedTheme);
    updateToggleIcon(savedTheme);

    themeToggle.addEventListener('click', function() {
        const currentTheme = root.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        root.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateToggleIcon(newTheme);
    });

    function updateToggleIcon(theme) {
        const isDark = theme === 'dark';
        themeToggle.setAttribute('aria-pressed', String(isDark));
        themeToggle.setAttribute('aria-label', isDark ? 'Activează tema luminoasă' : 'Activează tema întunecată');
    }

    const typingTitle = document.getElementById('typing-title');
    if (typingTitle) {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reduceMotion) {
            const text = typingTitle.textContent;
            typingTitle.textContent = '';
            let i = 0;
            function type() {
                if (i < text.length) {
                    typingTitle.textContent += text.charAt(i);
                    i++;
                    setTimeout(type, 42);
                }
            }
            type();
        }
    }

    const navToggle = document.getElementById('navToggle');
    const navMenu = document.getElementById('navMenu');
    const backToTop = document.getElementById('backToTop');
    const navbar = document.getElementById('navbar');
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('section[id]');
    const revealElements = document.querySelectorAll('.reveal');

    navToggle.addEventListener('click', function() {
        const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
        navToggle.setAttribute('aria-expanded', !isOpen);
        navToggle.classList.toggle('open', !isOpen);
        navMenu.classList.toggle('open', !isOpen);
    });

    navLinks.forEach(link => {
        link.addEventListener('click', function() {
            navMenu.classList.remove('open');
            navToggle.classList.remove('open');
            navToggle.setAttribute('aria-expanded', 'false');
        });
    });

    document.addEventListener('click', function(event) {
        if (!navToggle.contains(event.target) && !navMenu.contains(event.target)) {
            navMenu.classList.remove('open');
            navToggle.classList.remove('open');
            navToggle.setAttribute('aria-expanded', 'false');
        }
    });

    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && navMenu.classList.contains('open')) {
            navMenu.classList.remove('open');
            navToggle.classList.remove('open');
            navToggle.setAttribute('aria-expanded', 'false');
            navToggle.focus();
        }
    });

    if (!('IntersectionObserver' in window)) {
        revealElements.forEach(el => el.classList.add('visible'));
        return;
    }

    document.documentElement.classList.add('reveal-ready');

    const sectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const currentId = entry.target.id;
                navLinks.forEach(link => {
                    link.classList.toggle('active', link.getAttribute('href') === `#${currentId}`);
                });
            }
        });
    }, { rootMargin: '-40% 0px -55% 0px' });

    sections.forEach(section => sectionObserver.observe(section));

    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                revealObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.15 });

    revealElements.forEach(el => revealObserver.observe(el));

    window.addEventListener('scroll', function() {
        navbar.classList.toggle('scrolled', window.scrollY > 10);
        backToTop.classList.toggle('visible', window.scrollY > 400);
    });

    backToTop.addEventListener('click', function() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
});
