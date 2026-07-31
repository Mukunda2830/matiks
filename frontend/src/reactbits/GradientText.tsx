import React, { ReactNode } from 'react';
import './GradientText.css';

interface GradientTextProps {
  children: ReactNode;
  className?: string;
  colors?: string[];
  animationSpeed?: number;
  showBorder?: boolean;
}

export default function GradientText({
  children,
  className = '',
  colors = ['#2563eb', '#3b82f6', '#1d4ed8', '#60a5fa', '#2563eb'],
  animationSpeed = 8,
  showBorder = false,
}: GradientTextProps) {
  const gradientStyle = {
    backgroundImage: `linear-gradient(to right, ${colors.join(', ')})`,
    animationDuration: `${animationSpeed}s`,
  };

  return (
    <div className={`animated-gradient-text-container ${showBorder ? 'with-border' : ''} ${className}`}>
      {showBorder && (
        <div className="animated-gradient-overlay" style={gradientStyle} />
      )}
      <span className="animated-gradient-text-content" style={gradientStyle}>
        {children}
      </span>
    </div>
  );
}
