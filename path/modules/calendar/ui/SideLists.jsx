import React from 'react';
import { ListGroup, ListGroupItem } from 'react-bootstrap';

const SideLists = ({ calendars, onSelect }) => {
  return (
    <div>
      <h2>Calendars</h2>
      <ListGroup>
        {calendars.map((calendar) => (
          <ListGroupItem
            key={calendar.id}
            active={calendar.id === selectedCalendar.id}
            onClick={() => onSelect(calendar)}
          >
            {calendar.name}{' '}
            <span style={{ color: calendar.color }}>&#9679;</span>
          </ListGroupItem>
        ))}
      </ListGroup>
    </div>
  );
};

export default SideLists;