/**
 * StarBorder — ReactBits component (TS adaptation)
 * Source: https://reactbits.dev/animations/star-border
 *
 * Wraps any element with an animated star/light border effect.
 * Great for highlighting active states (e.g. active pipeline stage).
 */
import { ElementType, ReactNode, CSSProperties } from 'react';
import './StarBorder.css';

interface StarBorderProps {
  as?: ElementType;
  className?: string;
  color?: string;
  speed?: string;
  thickness?: number;
  children: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

const StarBorder = ({
  as: Component = 'div',
  className = '',
  color = '#58a6ff',
  speed = '4s',
  thickness = 1,
  children,
  style,
  ...rest
}: StarBorderProps) => {
  return (
    <Component
      className={`star-border-container ${className}`}
      style={{ padding: `${thickness}px 0`, ...style }}
      {...rest}
    >
      <div
        className="border-gradient-bottom"
        style={{
          background: `radial-gradient(circle, ${color}, transparent 10%)`,
          animationDuration: speed,
        }}
      />
      <div
        className="border-gradient-top"
        style={{
          background: `radial-gradient(circle, ${color}, transparent 10%)`,
          animationDuration: speed,
        }}
      />
      <div className="inner-content">{children}</div>
    </Component>
  );
};

export default StarBorder;
