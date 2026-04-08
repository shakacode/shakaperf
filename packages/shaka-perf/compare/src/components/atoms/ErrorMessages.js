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

class ErrorMessages extends React.Component {
  constructor (props) {
    super(props);
    this.state = {};
  }

  render () {
    const annotationError = this.props.info.annotationErrorMsg;
    const engineError = this.props.info.engineErrorMsg;
    const visregError = this.props.info.error;
    const display = !!annotationError || !!engineError || !!visregError;

    return (
      <DetailsPanel display={display}>
        {annotationError && <ErrorMsg display={true}>{annotationError}</ErrorMsg>}
        {!annotationError && visregError && (
          <ErrorMsg display={true}>VISREG ERROR: {visregError}</ErrorMsg>
        )}
        {/* Raw engine error hidden in DOM; accessible via devtools */}
        <div style={{ display: 'none' }} data-engine-error={engineError || ''}>
          ENGINE ERROR: {engineError}
        </div>
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
