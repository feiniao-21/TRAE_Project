document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded, initializing...');

    const { Engine, Render, Runner, World, Bodies, Body, Events } = Matter;

    const container = document.getElementById('matter-container');
    const video = document.getElementById('video');

    if (!container || !video) {
        console.error('Required elements not found!');
        return;
    }

    const engine = Engine.create({ gravity: { x: 0, y: 0.1 } });
    const world = engine.world;

    const render = Render.create({
        element: container,
        engine: engine,
        options: {
            width: window.innerWidth,
            height: window.innerHeight,
            wireframes: false,
            background: 'transparent'
        }
    });

    Render.run(render);
    const runner = Runner.create();
    Runner.run(runner, engine);

    // 记录初始位置并计算中心点
    const cardElements = Array.from(document.querySelectorAll('.card'));
    console.log('Total card elements found:', cardElements.length);

    const initialPositions = cardElements.map((cardElement, i) => {
        const rect = cardElement.getBoundingClientRect();
        const width = rect.width || cardElement.offsetWidth || 150;
        const height = rect.height || cardElement.offsetHeight || 60;
        
        console.log(`Card ${i} [${cardElement.innerText.trim().substring(0, 15)}]: ${width}x${height} at (${rect.left}, ${rect.top})`);
        
        return { 
            x: rect.left + width / 2, 
            y: rect.top + height / 2,
            width,
            height,
            element: cardElement
        };
    });

    if (initialPositions.length === 0) {
        console.error('No cards found to initialize!');
        return;
    }

    const initialCenter = {
        x: initialPositions.reduce((sum, pos) => sum + pos.x, 0) / initialPositions.length,
        y: initialPositions.reduce((sum, pos) => sum + pos.y, 0) / initialPositions.length
    };

    // 计算花瓣式排列所需的半径
    const maxCardHeight = Math.max(...initialPositions.map(pos => pos.height)) || 60;
    const maxCardWidth = Math.max(...initialPositions.map(pos => pos.width)) || 150;
    
    // 大幅增加半径，确保能看出一个清晰的圆
    const petalOrbitRadius = (maxCardHeight * 2.5 * initialPositions.length) / (2 * Math.PI) + 120;

    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;

    console.log(`Calculated Radius: ${petalOrbitRadius}, Center: (${centerX}, ${centerY})`);

    const cards = initialPositions.map((pos, index) => {
        const body = Bodies.rectangle(pos.x, pos.y, pos.width, pos.height, { 
            restitution: 0.7,
            frictionAir: 0.05,
            density: 0.001
        });
        body.element = pos.element;
        body.cardWidth = pos.width; // 记录宽度供计算旋转
        body.cardHeight = pos.height; // 记录高度
        return body;
    });

    World.add(world, cards);
    console.log('Physics world initialized with cards');

    let hands;
    try {
        hands = new Hands({
            locateFile: (file) => {
                const url = `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
                console.log('Loading MediaPipe file:', file);
                return url;
            }
        });

        hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
            selfieMode: true
        });

        hands.onResults(onResults);
        console.log('MediaPipe Hands initialized');
    } catch (e) {
        console.error('Failed to initialize MediaPipe Hands:', e);
    }

    const camera = new Camera(video, {
        onFrame: async () => {
            try {
                if (hands) await hands.send({ image: video });
            } catch (e) {
                console.error('Error in camera onFrame:', e);
            }
        },
        width: 640,
        height: 480
    });

    camera.start()
        .then(() => console.log('Camera started successfully'))
        .catch(e => {
            console.error('Failed to start camera:', e);
            alert('无法启动摄像头，请确保已授予权限并使用 HTTPS 或 localhost。');
        });

    let handBodies = [];
    let handLandmarks = [];

    function onResults(results) {
        handLandmarks = results.multiHandLandmarks || [];

        // 清理旧的手势碰撞体
        handBodies.forEach(body => World.remove(world, body));
        handBodies = [];

        if (handLandmarks.length > 0) {
            handLandmarks.forEach(landmarks => {
                const collisionIndices = [0, 4, 8, 12, 16, 20];
                collisionIndices.forEach(index => {
                    const landmark = landmarks[index];
                    const handX = landmark.x * window.innerWidth;
                    const handY = landmark.y * window.innerHeight;

                    const handBody = Bodies.circle(handX, handY, 20, { 
                        isStatic: true, 
                        label: 'hand',
                        render: { visible: false }
                    });
                    handBodies.push(handBody);
                });
            });
            World.add(world, handBodies);
        }
    }

    // 旋转和回归效果：在每一帧施加引导力
    Events.on(engine, 'beforeUpdate', () => {
        const time = engine.timing.timestamp;
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        
        const rotationSpeed = 0.0005;
        
        let orbitRadius = petalOrbitRadius;
        const maxAllowedOuterRadius = Math.min(window.innerWidth, window.innerHeight) / 2 - 20;
        if (orbitRadius + maxCardWidth > maxAllowedOuterRadius) {
            orbitRadius = Math.max(10, maxAllowedOuterRadius - maxCardWidth);
        }

        cards.forEach((body, index) => {
            const angleOffset = (index / cards.length) * Math.PI * 2;
            const orbitAngle = angleOffset + time * rotationSpeed;

            const distToCenter = orbitRadius + body.cardWidth / 2;
            const targetX = centerX + Math.cos(orbitAngle) * distToCenter;
            const targetY = centerY + Math.sin(orbitAngle) * distToCenter;

            const dx = targetX - body.position.x;
            const dy = targetY - body.position.y;
            
            const attractionStrength = 0.00002;
            const forceX = dx * attractionStrength;
            const forceY = dy * attractionStrength - 0.0001;

            Body.applyForce(body, body.position, { x: forceX, y: forceY });

            const targetBodyAngle = orbitAngle + Math.PI; 
            const angleDiff = targetBodyAngle - body.angle;
            const normalizedDiff = ((angleDiff + Math.PI) % (Math.PI * 2)) - Math.PI;
            Body.setAngularVelocity(body, body.angularVelocity + normalizedDiff * 0.001);
        });
    });

    Events.on(engine, 'afterUpdate', () => {
        cards.forEach(body => {
            const { x, y } = body.position;
            const angle = body.angle;
            if (body.element) {
                // 使用已经获取到的宽度高度来居中，避免频繁读取 offsetWidth/Height
                const w = body.cardWidth || body.element.offsetWidth || 150;
                const h = body.cardHeight || body.element.offsetHeight || 60;
                body.element.style.transform = `translate(${x - w / 2}px, ${y - h / 2}px) rotate(${angle}rad)`;
            }
        });

        const context = render.context;
        if (context) {
            context.clearRect(0, 0, render.canvas.width, render.canvas.height);

            for (const landmarks of handLandmarks) {
                if (typeof drawConnectors === 'function' && typeof HAND_CONNECTIONS !== 'undefined') {
                    drawConnectors(context, landmarks, HAND_CONNECTIONS, { color: '#FFFFFF', lineWidth: 2 });
                }
                if (typeof drawLandmarks === 'function') {
                    drawLandmarks(context, landmarks, { color: '#FFFFFF', radius: 3 });
                }
            }
        }
    });

    // 添加边界
    const wallOptions = { isStatic: true, render: { visible: false } };
    World.add(world, [
        Bodies.rectangle(window.innerWidth / 2, -25, window.innerWidth, 50, wallOptions), // top
        Bodies.rectangle(window.innerWidth / 2, window.innerHeight + 25, window.innerWidth, 50, wallOptions), // bottom
        Bodies.rectangle(-25, window.innerHeight / 2, 50, window.innerHeight, wallOptions), // left
        Bodies.rectangle(window.innerWidth + 25, window.innerHeight / 2, 50, window.innerHeight, wallOptions) // right
    ]);
});
