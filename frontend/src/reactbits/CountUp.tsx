import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  to: number;
  from?: number;
  direction?: 'up' | 'down';
  delay?: number;
  duration?: number;
  className?: string;
  decimals?: number;
}

export default function CountUp({
  to,
  from = 0,
  delay = 0,
  duration = 0.8,
  className = '',
  decimals = 0,
}: CountUpProps) {
  const [count, setCount] = useState<number>(from);
  const startTimeRef = useRef<number | null>(null);
  const startValRef = useRef<number>(from);

  useEffect(() => {
    startValRef.current = count;
    startTimeRef.current = null;
    let animationFrameId: number;

    const timeoutId = setTimeout(() => {
      const step = (timestamp: number) => {
        if (!startTimeRef.current) startTimeRef.current = timestamp;
        const progress = Math.min((timestamp - startTimeRef.current) / (duration * 1000), 1);
        const easeOutQuad = (t: number) => t * (2 - t);
        const currentVal = startValRef.current + (to - startValRef.current) * easeOutQuad(progress);
        
        setCount(currentVal);

        if (progress < 1) {
          animationFrameId = requestAnimationFrame(step);
        } else {
          setCount(to);
        }
      };

      animationFrameId = requestAnimationFrame(step);
    }, delay * 1000);

    return () => {
      clearTimeout(timeoutId);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [to, duration, delay]);

  return (
    <span className={className}>
      {count.toFixed(decimals)}
    </span>
  );
}
