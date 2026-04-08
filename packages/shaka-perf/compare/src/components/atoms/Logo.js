import React from 'react';
import styled from 'styled-components';
import { colors, fonts } from '../../styles';

const LogoText = styled.a`
  font-family: ${fonts.latoBold};
  font-size: 18px;
  color: ${colors.primaryText};
  text-decoration: none;
  letter-spacing: 1.5px;
  text-transform: uppercase;

  &:hover {
    color: ${colors.secondaryText};
  }
`;

export default class Logo extends React.Component {
  render () {
    return (
      <LogoText href="https://github.com/shakacode/shakaperf" target="_blank">
        Shaka Vis Reg
      </LogoText>
    );
  }
}
