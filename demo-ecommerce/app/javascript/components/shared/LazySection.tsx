import React, { useRef, useState, useEffect } from 'react';
import LoadingSpinner from './LoadingSpinner';

interface LazySectionProps {
  children: React.ReactNode;
  rootMargin?: string;
}

const LazySection: React.FC<LazySectionProps> = ({ children, rootMargin = '0px' }) => {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [mounted, rootMargin]);

  if (!mounted) return null;

  return visible ? <>{children}</> : <LoadingSpinner ref={sentinelRef} />;
};

export default LazySection;
