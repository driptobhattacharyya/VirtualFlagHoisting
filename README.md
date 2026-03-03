# Independence Day Flag Hoisting Application

## Overview
This application was created for Independence Day celebrations. It allows users to mimic the pulling of a thread in front of their laptop camera, which will hoist the Indian national flag on screen. When the flag reaches the top, a celebratory animation with fireworks will play.

## Features
- Hand gesture recognition using MediaPipe to detect pulling motion
- Realistic Indian flag with proper colors and proportions
- Ashoka Chakra in the center of the flag
- Wind simulation effect on the flag
- Fireworks celebration when the flag reaches the top
- Decorative elements and background
- Camera feed display for user guidance

## Requirements
- Python 3.6 or higher
- OpenCV
- MediaPipe
- Pygame
- NumPy

## Installation
1. Ensure you have Python installed
2. Install the required packages:
   ```
   pip install opencv-python mediapipe pygame numpy
   ```
3. Run the application:
   ```
   python main.py
   ```

## How to Use
1. Position yourself in front of your laptop camera
2. Make a pulling down motion with your hand to hoist the flag
3. Continue pulling until the flag reaches the top
4. Enjoy the celebration animation
5. Press 'X' to close the application when finished

## Technical Details
- The application uses MediaPipe's hand tracking to detect hand landmarks
- The index finger movement is tracked to detect pulling motion
- The flag follows the standard Indian tricolor design with proper proportions (3:2 ratio)
- The Ashoka Chakra is displayed in the center of the white stripe
- Fireworks are implemented using particle systems

## Credits
- Indian flag specifications from the official guidelines
- Ashoka Chakra image from Wikimedia Commons
- Background and decorative elements from open sources