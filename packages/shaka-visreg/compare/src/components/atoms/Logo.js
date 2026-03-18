import React from 'react';
import styled from 'styled-components';

const LogoLink = styled.a`
  display: block;
  text-decoration: none;
`;

const LogoSvg = styled.svg`
  display: block;
  height: 35px;
`;

export default class Logo extends React.Component {
  render () {
    return (
      <LogoLink href="https://github.com/shakacode/shakaperf" target="_blank">
        <LogoSvg viewBox="0 0 220 35" xmlns="http://www.w3.org/2000/svg" aria-label="Shaka Vis Reg">
          <defs>
            <linearGradient id="shakaGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#4F46E5" />
              <stop offset="100%" stopColor="#7C3AED" />
            </linearGradient>
          </defs>
          <text
            x="0"
            y="26"
            fontFamily="system-ui, -apple-system, sans-serif"
            fontWeight="700"
            fontSize="22"
            fill="url(#shakaGradient)"
            letterSpacing="-0.5"
          >
            Shaka
          </text>
          <text
            x="74"
            y="26"
            fontFamily="system-ui, -apple-system, sans-serif"
            fontWeight="400"
            fontSize="22"
            fill="#374151"
            letterSpacing="-0.5"
          >
            Vis Reg
          </text>
          <circle cx="68" cy="22" r="2.5" fill="#7C3AED" opacity="0.6" />
        </LogoSvg>
      </LogoLink>
    );
  }
}
