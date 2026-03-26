import React from 'react';
import { connect } from 'react-redux';
import styled from 'styled-components';
import { colors, fonts } from '../../styles';

const DetailsPanel = styled.div`
  background: transparent;
  display: ${props => (props.display ? 'block' : 'none')};
  padding: 10px;
  font-family: ${fonts.latoRegular};
  color: ${colors.secondaryText};
`;

const ErrorMsg = styled.p`
  word-wrap: break-word;
  font-family: monospace;
  background: rgb(251, 234, 234);
  padding: 2ex;
  color: brown;
  display: ${props => (props.display ? 'block' : 'none')};
`;

const ScreenshotImg = styled.img`
  max-width: 100%;
  border: 2px solid brown;
  margin-top: 10px;
`;

const ScreenshotLabel = styled.p`
  font-family: monospace;
  color: brown;
  font-size: 12px;
  margin: 10px 0 4px;
`;

class ErrorMessages extends React.Component {
  constructor (props) {
    super(props);
    this.state = {};
  }

  render () {
    const visregError = this.props.info.error;
    const engineError = this.props.info.engineErrorMsg;
    const errorScreenshot = this.props.info.errorScreenshot;
    const display = !!engineError || !!visregError;

    return (
      <DetailsPanel display={display}>
        <ErrorMsg display={engineError}>ENGINE ERROR: {engineError}</ErrorMsg>
        <ErrorMsg display={visregError}>
          VISREG ERROR: {visregError}
        </ErrorMsg>
        {errorScreenshot && (
          <div style={{ textAlign: 'center' }}>
            <ScreenshotLabel>Browser state at time of error:</ScreenshotLabel>
            <ScreenshotImg src={errorScreenshot} alt="Browser state at time of error" />
          </div>
        )}
      </DetailsPanel>
    );
  }
}

const mapStateToProps = state => {
  return {
    settings: state.layoutSettings
  };
};

const ErrorMessagesContainer = connect(mapStateToProps)(ErrorMessages);

export default ErrorMessagesContainer;
